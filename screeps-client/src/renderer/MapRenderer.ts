import { Application, Container, Graphics, RenderTexture, Sprite, Text, Texture } from 'pixi.js'
import type { RoomMap2Data, Badge } from 'screeps-connectivity'
import { BadgeTextureCache } from './BadgeTextureCache.js'
import { parseRoomName, formatRoomName } from '~/utils/roomName.js'
import { getTerrainCacheBlob, saveTerrainCacheBlob, blobToImageBitmap, imageBitmapToBlob } from './terrainCache.js'
import TerrainWorker from './terrain.worker.ts?worker'
import {
  TERRAIN_WALL, TERRAIN_ROAD, TERRAIN_BORDER,
  OBJ_GOLD, OBJ_BLUE, OBJ_CYAN, OBJ_ORANGE,
} from '~/renderer/colors.js'

export const MAP_TILE_SIZE = 3
export const MAP_ROOM_SIZE = MAP_TILE_SIZE * 50  // 150px per room

// Terrain baked to a GPU texture — two LOD tiers to avoid upscaling blur.
// LOD 0 (zoom < 1): zoomed out, many rooms, small texture fine
// LOD 1 (zoom ≥ 1): zoomed in, crisp at native and above
// LOD_TEXTURE_SIZES moved to worker
const LOD_ZOOM_THRESHOLD = 1
// Rooms within this many cells beyond the visible viewport are kept in memory (scroll buffer)
const CLEAR_PADDING = 50
const POOL_SIZE = 2600 // max visible rooms plus padding
// Wait this long after the last viewport change before firing onVisibleRoomsChanged
const VISIBLE_DEBOUNCE_MS = 5

const MIN_ZOOM = 0.2
const MAX_ZOOM = 5

const COLOR_SOURCE     = OBJ_GOLD    // sources
const COLOR_CONTROLLER = OBJ_BLUE    // controllers
const COLOR_MINERAL    = OBJ_CYAN    // minerals
const COLOR_KEEPER     = OBJ_ORANGE  // source keeper lairs
const COLOR_USER       = 0x4488ff    // player creeps/structures
const MAP2_FIXED_KEYS  = new Set(['w', 'r', 'pb', 'p', 's', 'c', 'm', 'k'])

interface RoomEntry {
  container: Container
  terrainSprite: Sprite
  texLo: RenderTexture | null  // LOD 0
  texHi: RenderTexture | null  // LOD 1
  map2Graphics: Graphics
  ownerOverlay: Graphics
  badgeSprite?: Sprite
  nameLabel: Text
}

export interface MapRendererCallbacks {
  onRoomHover: (room: string | null) => void
  onRoomClick: (room: string) => void
  onVisibleRoomsChanged: (rooms: string[]) => void
  onZoomChanged?: (zoom: number) => void
}

export class MapRenderer {
  readonly app: Application
  private world!: Container
  private boundsGraphics: Graphics | null = null
  private selectionGraphics: Graphics | null = null
  private safeModeGraphics: Graphics | null = null
  private readonly safeModeRooms = new Set<string>()
  private readonly activeRooms = new Map<string, RoomEntry>()
  private readonly roomPool: RoomEntry[] = []
  private readonly terrainBaked = new Set<string>()
  private readonly terrainData  = new Map<string, Uint8Array>()  // raw bytes kept until texHi is baked
  private worker: Worker
  private pendingBakes = new Map<number, { roomName: string, lod: number, resolve: (bmp: ImageBitmap) => void, reject: (err: unknown) => void }>()
  private nextBakeId = 0
  public currentShard: string = 'shard0'
  private readonly callbacks: MapRendererCallbacks
  private resizeObserver: ResizeObserver | null = null
  private _destroyed = false
  private showRoomNames = false
  private worldBoundsSet: { minX: number; maxX: number; minY: number; maxY: number } | null = null
  private lastVisibleBounds: { rxMin: number; rxMax: number; ryMin: number; ryMax: number } | null = null

  private animTargetX = 0
  private animTargetY = 0
  private isAnimating = false

  private isDragging = false
  private hasDragged = false
  private dragStartX = 0
  private dragStartY = 0
  private dragWorldX = 0
  private dragWorldY = 0
  private lastVisibleKey = ''
  private visibleDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private selectedRoom: string | null = null
  private currentUserId: string | null = null
  private readonly badgeCache = new BadgeTextureCache()

  constructor(callbacks: MapRendererCallbacks) {
    this.app = new Application()
    this.callbacks = callbacks
    this.worker = new TerrainWorker()
    this.worker.onmessage = (e) => {
      const { id, bitmap } = e.data
      const pending = this.pendingBakes.get(id)
      if (pending) {
        this.pendingBakes.delete(id)
        pending.resolve(bitmap)
      }
    }
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const container = canvas.parentElement ?? canvas
    const { width, height } = container.getBoundingClientRect()

    await this.app.init({
      canvas,
      width,
      height,
      background: TERRAIN_WALL,
      antialias: false,
      preference: 'webgl',
    })

    this.resizeObserver = new ResizeObserver((entries) => {
      const { width: newW, height: newH } = entries[0].contentRect
      const oldW = this.app.screen.width
      const oldH = this.app.screen.height
      this.app.renderer.resize(newW, newH)
      this.world.x += (newW - oldW) / 2
      this.world.y += (newH - oldH) / 2
    })
    this.resizeObserver.observe(container)

    this.world = new Container()
    this.app.stage.addChild(this.world)
    this.app.stage.eventMode = 'static'
    this.app.stage.hitArea = this.app.screen

    this.boundsGraphics = new Graphics()
    this.world.addChild(this.boundsGraphics)

    this.selectionGraphics = new Graphics()
    this.world.addChild(this.selectionGraphics)

    this.safeModeGraphics = new Graphics()
    this.world.addChild(this.safeModeGraphics)

    this.setupInteraction()
    this.app.ticker.add(() => {
      if (this.isAnimating) {
        const dx = this.animTargetX - this.world.x
        const dy = this.animTargetY - this.world.y
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
          this.world.x = this.animTargetX
          this.world.y = this.animTargetY
          this.isAnimating = false
        } else {
          this.world.x += dx * 0.2
          this.world.y += dy * 0.2
        }
      }
      this.checkVisibleRooms()
    })
  }

  get zoom(): number {
    return this.world?.scale.x ?? 1
  }

  setZoom(next: number): void {
    if (!this.world) return
    next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next))
    const scale = this.world.scale.x
    if (next === scale) return

    const cx = this.app.screen.width / 2
    const cy = this.app.screen.height / 2
    const wx = (cx - this.world.x) / scale
    const wy = (cy - this.world.y) / scale

    const prevLOD = this.getLOD()
    const prevZoomAboveThreshold = this.zoom >= LOD_ZOOM_THRESHOLD

    this.world.scale.set(next)
    this.world.x = cx - wx * next
    this.world.y = cy - wy * next

    if (this.getLOD() !== prevLOD) this.applyLOD()
    if ((next >= LOD_ZOOM_THRESHOLD) !== prevZoomAboveThreshold) this.updateAllNameLabels()
    this.callbacks.onZoomChanged?.(next)
    this.setSelectedRoom(this.selectedRoom)
    this.redrawSafeMode()
  }

  centerOn(rx: number, ry: number, animated = false): void {
    const cx = rx * MAP_ROOM_SIZE + MAP_ROOM_SIZE / 2
    const cy = ry * MAP_ROOM_SIZE + MAP_ROOM_SIZE / 2
    const scale = this.world.scale.x
    const destX = this.app.screen.width  / 2 - cx * scale
    const destY = this.app.screen.height / 2 - cy * scale
    if (animated) {
      this.animTargetX = destX
      this.animTargetY = destY
      this.isAnimating = true
    } else {
      this.isAnimating = false
      this.world.x = destX
      this.world.y = destY
    }
  }


  private async getTerrainBitmap(roomName: string, lod: number, raw: Uint8Array): Promise<ImageBitmap | null> {
    const shard = this.currentShard
    try {
      // Check Cache API first
      const cachedBlob = await getTerrainCacheBlob(shard, roomName, lod)
      if (cachedBlob) {
        return await blobToImageBitmap(cachedBlob)
      }

      // Cache miss -> use Web Worker
      const id = this.nextBakeId++
      const promise = new Promise<ImageBitmap>((resolve, reject) => {
        this.pendingBakes.set(id, { roomName, lod, resolve, reject })
      })
      this.worker.postMessage({ id, roomName, lod, raw })

      const bitmap = await promise

      // Save to Cache API asynchronously (don't block)
      imageBitmapToBlob(bitmap).then(blob => {
        saveTerrainCacheBlob(shard, roomName, lod, blob)
      }).catch(err => console.warn('Failed to save to terrainCache:', err))

      return bitmap
    } catch (e) {
      console.warn('Error getting terrain bitmap:', e)
      return null
    }
  }

  async setRoomTerrain(roomName: string, terrain: { raw: Uint8Array }): Promise<void> {
    const entry = this.getOrCreate(roomName)
    const raw = terrain.raw

    const lod = this.getLOD()

    // Zoomed out - keep raw bytes for lazy hi-res bake if user zooms in later
    if (lod === 0) {
      this.terrainData.set(roomName, raw)
    }

    const bitmap = await this.getTerrainBitmap(roomName, lod, raw)
    if (!bitmap) return

    // Re-check if room was cleared while we were waiting
    if (!this.activeRooms.has(roomName)) {
      bitmap.close()
      return
    }

    const tex = Texture.from(bitmap)

    if (lod === 0) {
      if (entry.texLo && !entry.texLo.destroyed) entry.texLo.destroy(true)
      entry.texLo = tex as unknown as RenderTexture
      if (this.getLOD() === 0) if (entry.texLo) entry.terrainSprite.texture = entry.texLo
    } else {
      if (entry.texHi && !entry.texHi.destroyed) entry.texHi.destroy(true)
      entry.texHi = tex as unknown as RenderTexture
      if (this.getLOD() === 1) if (entry.texHi) entry.terrainSprite.texture = entry.texHi
    }

    entry.terrainSprite.width  = MAP_ROOM_SIZE
    entry.terrainSprite.height = MAP_ROOM_SIZE
    this.terrainBaked.add(roomName)
  }


  private getLOD(): number {
    return this.zoom < LOD_ZOOM_THRESHOLD ? 0 : 1
  }


  private async applyLOD(): Promise<void> {
    const hi = this.getLOD() === 1

    const tasks = []

    for (const [roomName, entry] of this.activeRooms) {
      if (!this.terrainBaked.has(roomName)) continue

      if (hi && !entry.texHi) {
        // First time at LOD 1 for this room
        const raw = this.terrainData.get(roomName)
        if (raw) {
          this.terrainData.delete(roomName)
          tasks.push(
            this.getTerrainBitmap(roomName, 1, raw).then((bitmap) => {
              if (bitmap && this.activeRooms.has(roomName)) {
                entry.texHi = Texture.from(bitmap) as unknown as RenderTexture
                if (this.getLOD() === 1) entry.terrainSprite.texture = entry.texHi
              } else if (bitmap) {
                bitmap.close()
              }
            })
          )
        }
      } else {
        const tex = hi ? entry.texHi : entry.texLo
        if (tex && !tex.destroyed) entry.terrainSprite.texture = tex
      }
    }

    await Promise.all(tasks)
  }



  setRoomMap2(roomName: string, data: Partial<RoomMap2Data>, source: 'cache' | 'live' = 'live'): void {
    const entry = this.getOrCreate(roomName)
    const g = entry.map2Graphics
    g.alpha = source === 'cache' ? 0.6 : 1.0
    const MT = MAP_TILE_SIZE
    g.clear()

    // Roads — same color as TERRAIN_ROAD, small rect
    const roads = data.r ?? []
    for (const [x, y] of roads) {
      g.rect(x * MT, y * MT, MT, MT)
    }
    if (roads.length) g.fill(TERRAIN_ROAD)

    // Player-built walls / ramparts
    const walls = data.w ?? []
    for (const [x, y] of walls) {
      g.rect(x * MT + 0.5, y * MT + 0.5, MT - 1, MT - 1)
    }
    if (walls.length) g.fill(0x447744)

    // Sources — gold dot
    const sources = data.s ?? []
    for (const [x, y] of sources) {
      g.circle((x + 0.5) * MT, (y + 0.5) * MT, 2.5)
    }
    if (sources.length) g.fill(COLOR_SOURCE)

    // Controllers — blue dot
    const controllers = data.c ?? []
    for (const [x, y] of controllers) {
      g.circle((x + 0.5) * MT, (y + 0.5) * MT, 2.0)
    }
    if (controllers.length) g.fill(COLOR_CONTROLLER)

    // Minerals — cyan dot
    const minerals = data.m ?? []
    for (const [x, y] of minerals) {
      g.circle((x + 0.5) * MT, (y + 0.5) * MT, 2.0)
    }
    if (minerals.length) g.fill(COLOR_MINERAL)

    // Keeper lairs — orange dot
    const keepers = data.k ?? []
    for (const [x, y] of keepers) {
      g.circle((x + 0.5) * MT, (y + 0.5) * MT, 2.0)
    }
    if (keepers.length) g.fill(COLOR_KEEPER)

    // Power banks — orange dot (smaller)
    const powerBanks = data.pb ?? []
    for (const [x, y] of powerBanks) {
      g.circle((x + 0.5) * MT, (y + 0.5) * MT, 1.5)
    }
    if (powerBanks.length) g.fill(OBJ_ORANGE)

    // User objects — blue for current user, red for others
    for (const [key, positions] of Object.entries(data as Record<string, [number, number][]>)) {
      if (MAP2_FIXED_KEYS.has(key)) continue
      if (!Array.isArray(positions)) continue
      if (positions.length === 0) continue
      for (const [x, y] of positions) {
        g.circle((x + 0.5) * MT, (y + 0.5) * MT, 1.0)
      }
      const color = key === this.currentUserId ? COLOR_USER : 0xff0000
      g.fill(color)
    }
  }

  clearRoomMap2(roomName: string): void {
    this.activeRooms.get(roomName)?.map2Graphics.clear()
  }

  clearAllMap2(): void {
    for (const entry of this.activeRooms.values()) {
      entry.map2Graphics.clear()
    }
  }

  setRoomOwned(roomName: string, owned: boolean): void {
    const entry = this.getOrCreate(roomName)
    const g = entry.ownerOverlay
    g.clear()
    if (owned) {
      g.rect(0, 0, MAP_ROOM_SIZE, MAP_ROOM_SIZE)
      g.fill({ color: 0x990000, alpha: 0.18 })
    }
  }

  async setRoomBadge(roomName: string, badge?: Badge): Promise<void> {
    const entry = this.activeRooms.get(roomName)
    if (!entry) return

    if (!badge) {
      if (entry.badgeSprite) {
        entry.container.removeChild(entry.badgeSprite)
        entry.badgeSprite.destroy()
        entry.badgeSprite = undefined
      }
      return
    }

    try {
      // Avoid flicker/reload if the same badge is already shown.
      // We compare texture references as a fast path.
      const texture = await this.badgeCache.getOrCreate(badge)
      if (!this.activeRooms.has(roomName)) return // room was cleared while loading

      if (entry.badgeSprite) {
        if (entry.badgeSprite.texture === texture) {
          return
        }
        entry.badgeSprite.texture = texture
      } else {
        const sprite = new Sprite(texture)
        sprite.anchor.set(0.5)
        sprite.x = MAP_ROOM_SIZE / 2
        sprite.y = MAP_ROOM_SIZE / 2
        sprite.width = 24
        sprite.height = 24
        // Insert before nameLabel so the label stays on top
        const nameIndex = entry.container.getChildIndex(entry.nameLabel)
        entry.container.addChildAt(sprite, nameIndex)
        entry.badgeSprite = sprite
      }
    } catch (err) {
      console.warn('[MapRenderer] failed to load badge for', roomName, err)
    }
  }

  setCurrentUser(userId: string | null): void {
    this.currentUserId = userId
  }

  setSelectedRoom(room: string | null): void {
    this.selectedRoom = room
    if (!this.selectionGraphics) return
    this.selectionGraphics.clear()
    // Keep on top of all room containers
    this.world.removeChild(this.selectionGraphics)
    this.world.addChild(this.selectionGraphics)
    if (!room) return
    const coord = parseRoomName(room)
    if (!coord) return
    const x = coord.x * MAP_ROOM_SIZE
    const y = coord.y * MAP_ROOM_SIZE
    this.selectionGraphics.rect(x, y, MAP_ROOM_SIZE, MAP_ROOM_SIZE)
    const width = Math.max(2, Math.ceil(2 / this.zoom))
    this.selectionGraphics.stroke({ color: 0xffffff, width, alignment: 0 })
  }

  setRoomSafeMode(room: string, active: boolean): void {
    if (active) {
      this.safeModeRooms.add(room)
    } else {
      this.safeModeRooms.delete(room)
    }
    this.redrawSafeMode()
  }

  private redrawSafeMode(): void {
    if (!this.safeModeGraphics) return
    this.safeModeGraphics.clear()
    if (this.safeModeRooms.size === 0) return
    const width = Math.max(1, Math.ceil(1 / this.zoom))
    for (const room of this.safeModeRooms) {
      const coord = parseRoomName(room)
      if (!coord) continue
      const x = coord.x * MAP_ROOM_SIZE
      const y = coord.y * MAP_ROOM_SIZE
      this.safeModeGraphics.rect(x, y, MAP_ROOM_SIZE, MAP_ROOM_SIZE)
      this.safeModeGraphics.stroke({ color: 0xffff00, width, alignment: 1, alpha: 0.5 })
    }
    // Keep on top of all room containers, below selection
    this.world.removeChild(this.safeModeGraphics)
    this.world.addChild(this.safeModeGraphics)
  }

  setBounds(minX: number, maxX: number, minY: number, maxY: number): void {
    if (!this.boundsGraphics) return
    this.worldBoundsSet = { minX, maxX, minY, maxY }
    this.boundsGraphics.clear()
    const x = minX * MAP_ROOM_SIZE
    const y = minY * MAP_ROOM_SIZE
    const w = (maxX - minX + 1) * MAP_ROOM_SIZE
    const h = (maxY - minY + 1) * MAP_ROOM_SIZE
    // alignment: 0 = outer stroke — extends outward, never overlaps room tiles
    this.boundsGraphics.rect(x, y, w, h)
    this.boundsGraphics.stroke({ color: TERRAIN_BORDER, width: 6, alignment: 0 })
    this.updateAllNameLabels()
  }

  clearBounds(): void {
    this.worldBoundsSet = null
    this.boundsGraphics?.clear()
    this.updateAllNameLabels()
  }

  setShowRoomNames(show: boolean): void {
    this.showRoomNames = show
    this.updateAllNameLabels()
  }

  hasRoom(roomName: string): boolean {
    return this.terrainBaked.has(roomName)
  }


  clearRoom(roomName: string): void {
    const entry = this.activeRooms.get(roomName)
    if (!entry) return
    if (entry.texLo && !entry.texLo.destroyed) entry.texLo.destroy(true)
    if (entry.texHi && !entry.texHi.destroyed) entry.texHi.destroy(true)
    entry.texLo = null
    entry.texHi = null
    entry.terrainSprite.texture = Texture.EMPTY
    entry.map2Graphics.clear()
    entry.ownerOverlay.clear()
    if (entry.badgeSprite) {
      entry.container.removeChild(entry.badgeSprite)
      entry.badgeSprite.destroy()
      entry.badgeSprite = undefined
    }
    entry.container.visible = false
    this.safeModeRooms.delete(roomName)

    this.terrainBaked.delete(roomName)
    this.terrainData.delete(roomName)
    this.activeRooms.delete(roomName)

    // Return to pool if not too big, else destroy
    if (this.roomPool.length < POOL_SIZE) {
      this.roomPool.push(entry)
    } else {
      this.world.removeChild(entry.container)
      entry.container.destroy({ children: true, context: true })
    }
  }


  clearInvisibleRooms(visibleSet: ReadonlySet<string>): void {
    const b = this.lastVisibleBounds
    for (const name of [...this.activeRooms.keys()]) {
      if (visibleSet.has(name)) continue
      if (b) {
        const coord = parseRoomName(name)
        if (coord &&
            coord.x >= b.rxMin - CLEAR_PADDING && coord.x <= b.rxMax + CLEAR_PADDING &&
            coord.y >= b.ryMin - CLEAR_PADDING && coord.y <= b.ryMax + CLEAR_PADDING) continue
      }
      this.clearRoom(name)
    }
  }

  destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    if (this.visibleDebounceTimer !== null) {
      clearTimeout(this.visibleDebounceTimer)
      this.visibleDebounceTimer = null
    }
    for (const [, entry] of this.activeRooms) {
      if (entry.texLo && !entry.texLo.destroyed) entry.texLo.destroy(true)
      if (entry.texHi && !entry.texHi.destroyed) entry.texHi.destroy(true)
    }
    this.activeRooms.clear()
    this.safeModeRooms.clear()
    for (const entry of this.roomPool) {
      if (entry.texLo && !entry.texLo.destroyed) entry.texLo.destroy(true)
      if (entry.texHi && !entry.texHi.destroyed) entry.texHi.destroy(true)
    }
    this.roomPool.length = 0
    this.terrainBaked.clear()
    this.terrainData.clear()
    this.worker.terminate()
    this.pendingBakes.clear()
    this.badgeCache.destroy()
    try {
      this.app.destroy(false, { children: true, texture: true, context: true })
    } catch (e) {
      console.warn('[MapRenderer] destroy error (ignored):', e)
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────


  private getOrCreate(roomName: string): RoomEntry {
    const existing = this.activeRooms.get(roomName)
    if (existing) return existing

    const coord = parseRoomName(roomName)
    if (!coord) throw new Error(`MapRenderer: invalid room "${roomName}"`)

    let entry: RoomEntry
    if (this.roomPool.length > 0) {
      entry = this.roomPool.pop()!
    } else {
      const container = new Container()
      container.cullable = true

      const terrainSprite = new Sprite(Texture.EMPTY)
      const map2Graphics  = new Graphics()
      const ownerOverlay  = new Graphics()
      container.addChild(terrainSprite)
      container.addChild(map2Graphics)
      container.addChild(ownerOverlay)

      const nameLabel = new Text({
        text: '',
        style: { fontSize: 36, fill: 0x8b949e, fontFamily: 'ui-monospace, monospace' },
      })
      nameLabel.scale.set(0.25)
      nameLabel.x = 2
      nameLabel.y = 2
      container.addChild(nameLabel)

      this.world.addChild(container)

      entry = { container, terrainSprite, texLo: null, texHi: null, map2Graphics, ownerOverlay, nameLabel }
    }

    entry.container.x = coord.x * MAP_ROOM_SIZE
    entry.container.y = coord.y * MAP_ROOM_SIZE
    entry.container.visible = true
    entry.nameLabel.text = roomName
    entry.nameLabel.visible = this.nameLabelShouldShow(coord.x, coord.y)

    // Reset pooled badge sprite so a stale badge from a previous room doesn't leak through
    if (entry.badgeSprite) {
      entry.container.removeChild(entry.badgeSprite)
      entry.badgeSprite.destroy()
      entry.badgeSprite = undefined
    }

    // Keep overlays on top
    if (this.safeModeGraphics) {
      this.world.removeChild(this.safeModeGraphics)
      this.world.addChild(this.safeModeGraphics)
    }
    if (this.selectionGraphics) {
      this.world.removeChild(this.selectionGraphics)
      this.world.addChild(this.selectionGraphics)
    }

    this.activeRooms.set(roomName, entry)
    return entry
  }


  private nameLabelShouldShow(rx: number, ry: number): boolean {
    if (!this.showRoomNames) return false
    if (this.zoom < LOD_ZOOM_THRESHOLD) return false
    const b = this.worldBoundsSet
    if (b && (rx < b.minX || rx > b.maxX || ry < b.minY || ry > b.maxY)) return false
    return true
  }

  private updateAllNameLabels(): void {
    for (const [name, entry] of this.activeRooms) {
      const coord = parseRoomName(name)
      if (!coord) continue
      entry.nameLabel.visible = this.nameLabelShouldShow(coord.x, coord.y)
    }
  }

  private setupInteraction(): void {
    const stage = this.app.stage

    stage.on('pointerdown', (e) => {
      this.isAnimating = false
      this.isDragging = true
      this.hasDragged = false
      this.dragStartX = e.global.x
      this.dragStartY = e.global.y
      this.dragWorldX = this.world.x
      this.dragWorldY = this.world.y
    })

    stage.on('pointermove', (e) => {
      if (this.isDragging) {
        const dx = e.global.x - this.dragStartX
        const dy = e.global.y - this.dragStartY
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.hasDragged = true
        this.world.x = this.dragWorldX + dx
        this.world.y = this.dragWorldY + dy
      }
      this.emitHover(e.global.x, e.global.y)
    })

    stage.on('pointerup', (e) => {
      if (!this.hasDragged) {
        const room = this.screenToRoom(e.global.x, e.global.y)
        if (room) this.callbacks.onRoomClick(room)
      }
      this.isDragging = false
    })

    stage.on('pointerleave', () => {
      this.isDragging = false
      this.callbacks.onRoomHover(null)
    })

    this.app.canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      this.isAnimating = false
      const scale  = this.world.scale.x
      const factor = e.deltaY < 0 ? 1.1 : 0.9
      const next   = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale * factor))
      const wx     = (e.offsetX - this.world.x) / scale
      const wy     = (e.offsetY - this.world.y) / scale
      const prevLOD = this.getLOD()
      const prevZoomAboveThreshold = this.zoom >= LOD_ZOOM_THRESHOLD
      this.world.scale.set(next)
      this.world.x = e.offsetX - wx * next
      this.world.y = e.offsetY - wy * next
      if (this.getLOD() !== prevLOD) this.applyLOD()
      if ((next >= LOD_ZOOM_THRESHOLD) !== prevZoomAboveThreshold) this.updateAllNameLabels()
      this.callbacks.onZoomChanged?.(next)
      this.setSelectedRoom(this.selectedRoom)
    }, { passive: false })
  }

  private screenToRoom(sx: number, sy: number): string | null {
    const scale = this.world.scale.x
    const wx = (sx - this.world.x) / scale
    const wy = (sy - this.world.y) / scale
    const rx = Math.floor(wx / MAP_ROOM_SIZE)
    const ry = Math.floor(wy / MAP_ROOM_SIZE)
    return formatRoomName(rx, ry)
  }

  private emitHover(sx: number, sy: number): void {
    this.callbacks.onRoomHover(this.screenToRoom(sx, sy))
  }

  private checkVisibleRooms(): void {
    const scale  = this.world.scale.x
    const left   = (-this.world.x) / scale
    const top    = (-this.world.y) / scale
    const right  = (this.app.screen.width  - this.world.x) / scale
    const bottom = (this.app.screen.height - this.world.y) / scale

    const rxMin = Math.floor(left   / MAP_ROOM_SIZE) - 1
    const rxMax = Math.ceil (right  / MAP_ROOM_SIZE)
    const ryMin = Math.floor(top    / MAP_ROOM_SIZE) - 1
    const ryMax = Math.ceil (bottom / MAP_ROOM_SIZE)
    this.lastVisibleBounds = { rxMin, rxMax, ryMin, ryMax }

    const visible: string[] = []
    for (let rx = rxMin; rx <= rxMax; rx++) {
      for (let ry = ryMin; ry <= ryMax; ry++) {
        const name = formatRoomName(rx, ry)
        if (name) visible.push(name)
      }
    }

    const key = `${rxMin},${ryMin},${rxMax},${ryMax}`
    if (key !== this.lastVisibleKey) {
      this.lastVisibleKey = key
      if (this.visibleDebounceTimer !== null) clearTimeout(this.visibleDebounceTimer)
      this.visibleDebounceTimer = setTimeout(() => {
        this.visibleDebounceTimer = null
        this.callbacks.onVisibleRoomsChanged(visible)
      }, VISIBLE_DEBOUNCE_MS)
    }
  }
}
