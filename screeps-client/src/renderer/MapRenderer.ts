import { Application, Container, Graphics, RenderTexture, Sprite, Text, Texture } from 'pixi.js'
import type { RoomTerrain, RoomMap2Data } from 'screeps-connectivity'
import { parseRoomName, formatRoomName } from '~/utils/roomName.js'
import {
  TERRAIN_PLAIN, TERRAIN_WALL, TERRAIN_SWAMP, TERRAIN_ROAD, TERRAIN_BORDER,
  OBJ_GOLD, OBJ_BLUE, OBJ_CYAN, OBJ_ORANGE,
} from '~/renderer/colors.js'

export const MAP_TILE_SIZE = 3
export const MAP_ROOM_SIZE = MAP_TILE_SIZE * 50  // 150px per room

// Terrain baked to a GPU texture — two LOD tiers to avoid upscaling blur.
// LOD 0 (zoom < 1): zoomed out, many rooms, small texture fine
// LOD 1 (zoom ≥ 1): zoomed in, crisp at native and above
const LOD_TEXTURE_SIZES = [128, 512] as const
const LOD_ZOOM_THRESHOLD = 1
// Rooms within this many cells beyond the visible viewport are kept in memory (scroll buffer)
const CLEAR_PADDING = 50
// Above this room count the visible-rooms callback fires with an empty list — too zoomed out to load usefully
const MAX_VISIBLE_ROOMS = 5000
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
  private readonly rooms = new Map<string, RoomEntry>()
  private readonly terrainBaked = new Set<string>()
  private readonly terrainData  = new Map<string, Uint8Array>()  // raw bytes kept until texHi is baked
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

  constructor(callbacks: MapRendererCallbacks) {
    this.app = new Application()
    this.callbacks = callbacks
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

  setRoomTerrain(roomName: string, terrain: RoomTerrain): void {
    const entry = this.getOrCreate(roomName)
    const raw = terrain.raw

    if (entry.texLo && !entry.texLo.destroyed) entry.texLo.destroy()
    if (entry.texHi && !entry.texHi.destroyed) entry.texHi.destroy()
    entry.texHi = null

    entry.texLo = this.bakeTex(raw, LOD_TEXTURE_SIZES[0])

    if (this.getLOD() === 1) {
      // Already zoomed in — bake hi-res immediately so it's ready
      entry.texHi = this.bakeTex(raw, LOD_TEXTURE_SIZES[1])
      entry.terrainSprite.texture = entry.texHi
    } else {
      // Zoomed out — keep raw bytes for lazy hi-res bake if user zooms in later
      this.terrainData.set(roomName, raw)
      entry.terrainSprite.texture = entry.texLo
    }

    entry.terrainSprite.width  = MAP_ROOM_SIZE
    entry.terrainSprite.height = MAP_ROOM_SIZE
    this.terrainBaked.add(roomName)
  }

  private getLOD(): number {
    return this.zoom < LOD_ZOOM_THRESHOLD ? 0 : 1
  }

  // Bake terrain raw bytes to a RenderTexture at the given size.
  private bakeTex(raw: Uint8Array, size: number): RenderTexture {
    const MT = MAP_TILE_SIZE
    const g = new Graphics()
    g.rect(0, 0, MAP_ROOM_SIZE, MAP_ROOM_SIZE)
    g.fill(TERRAIN_PLAIN)
    let hasWalls = false
    for (let i = 0; i < 2500; i++) {
      if (raw[i] === 1) { g.rect((i % 50) * MT, Math.floor(i / 50) * MT, MT, MT); hasWalls = true }
    }
    if (hasWalls) g.fill(TERRAIN_WALL)
    let hasSwamp = false
    for (let i = 0; i < 2500; i++) {
      if (raw[i] === 2) { g.rect((i % 50) * MT, Math.floor(i / 50) * MT, MT, MT); hasSwamp = true }
    }
    if (hasSwamp) g.fill(TERRAIN_SWAMP)
    const rt = RenderTexture.create({ width: size, height: size })
    g.scale.set(size / MAP_ROOM_SIZE)
    this.app.renderer.render({ container: g, target: rt })
    g.destroy({ context: true })
    return rt
  }

  private applyLOD(): void {
    const hi = this.getLOD() === 1
    for (const [roomName, entry] of this.rooms) {
      if (!this.terrainBaked.has(roomName)) continue
      if (hi && !entry.texHi) {
        // First time at LOD 1 for this room — bake hi-res now and free raw bytes
        const raw = this.terrainData.get(roomName)
        if (raw) {
          entry.texHi = this.bakeTex(raw, LOD_TEXTURE_SIZES[1])
          this.terrainData.delete(roomName)
        }
      }
      const tex = hi ? entry.texHi : entry.texLo
      if (tex && !tex.destroyed) entry.terrainSprite.texture = tex
    }
  }

  setRoomMap2(roomName: string, data: RoomMap2Data): void {
    const entry = this.getOrCreate(roomName)
    const g = entry.map2Graphics
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

    // User objects — batched by user colour (all users same colour for now)
    let hasUserObjs = false
    for (const [key, positions] of Object.entries(data)) {
      if (MAP2_FIXED_KEYS.has(key)) continue
      if (!Array.isArray(positions)) continue
      for (const [x, y] of positions) {
        g.circle((x + 0.5) * MT, (y + 0.5) * MT, 1.0)
        hasUserObjs = true
      }
    }
    if (hasUserObjs) g.fill(COLOR_USER)
  }

  clearRoomMap2(roomName: string): void {
    this.rooms.get(roomName)?.map2Graphics.clear()
  }

  clearAllMap2(): void {
    for (const entry of this.rooms.values()) {
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

  setSelectedRoom(room: string | null): void {
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
    this.selectionGraphics.rect(x + 1, y + 1, MAP_ROOM_SIZE - 2, MAP_ROOM_SIZE - 2)
    this.selectionGraphics.stroke({ color: 0xffffff, width: 2 })
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
    const entry = this.rooms.get(roomName)
    if (!entry) return
    if (entry.texLo && !entry.texLo.destroyed) entry.texLo.destroy()
    if (entry.texHi && !entry.texHi.destroyed) entry.texHi.destroy()
    this.terrainBaked.delete(roomName)
    this.terrainData.delete(roomName)
    this.world.removeChild(entry.container)
    entry.container.destroy({ children: true, context: true })
    this.rooms.delete(roomName)
  }

  clearInvisibleRooms(visibleSet: ReadonlySet<string>): void {
    const b = this.lastVisibleBounds
    for (const name of [...this.rooms.keys()]) {
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
    for (const [, entry] of this.rooms) {
      if (entry.texLo && !entry.texLo.destroyed) entry.texLo.destroy()
      if (entry.texHi && !entry.texHi.destroyed) entry.texHi.destroy()
    }
    this.rooms.clear()
    this.terrainBaked.clear()
    this.terrainData.clear()
    try {
      this.app.destroy(false, { children: true, texture: true, context: true })
    } catch (e) {
      console.warn('[MapRenderer] destroy error (ignored):', e)
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private getOrCreate(roomName: string): RoomEntry {
    const existing = this.rooms.get(roomName)
    if (existing) return existing

    const coord = parseRoomName(roomName)
    if (!coord) throw new Error(`MapRenderer: invalid room "${roomName}"`)

    const container = new Container()
    container.x = coord.x * MAP_ROOM_SIZE
    container.y = coord.y * MAP_ROOM_SIZE
    container.cullable = true

    const terrainSprite = new Sprite(Texture.EMPTY)
    const map2Graphics  = new Graphics()
    const ownerOverlay  = new Graphics()
    container.addChild(terrainSprite)
    container.addChild(map2Graphics)
    container.addChild(ownerOverlay)

    const nameLabel = new Text({
      text: roomName,
      style: { fontSize: 36, fill: 0x8b949e, fontFamily: 'ui-monospace, monospace' },
    })
    nameLabel.scale.set(0.25)
    nameLabel.x = 2
    nameLabel.y = 2
    nameLabel.visible = this.nameLabelShouldShow(coord.x, coord.y)
    container.addChild(nameLabel)

    this.world.addChild(container)
    // Keep selection overlay on top of room containers
    if (this.selectionGraphics) {
      this.world.removeChild(this.selectionGraphics)
      this.world.addChild(this.selectionGraphics)
    }

    const entry: RoomEntry = { container, terrainSprite, texLo: null, texHi: null, map2Graphics, ownerOverlay, nameLabel }
    this.rooms.set(roomName, entry)
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
    for (const [name, entry] of this.rooms) {
      const coord = parseRoomName(name)
      if (!coord) continue
      entry.nameLabel.visible = this.nameLabelShouldShow(coord.x, coord.y)
    }
  }

  private setupInteraction(): void {
    const stage = this.app.stage

    stage.on('pointerdown', (e) => {
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

    const toReport = visible.length > MAX_VISIBLE_ROOMS ? [] : visible
    const key = `${rxMin},${ryMin},${rxMax},${ryMax}`
    if (key !== this.lastVisibleKey) {
      this.lastVisibleKey = key
      if (this.visibleDebounceTimer !== null) clearTimeout(this.visibleDebounceTimer)
      this.visibleDebounceTimer = setTimeout(() => {
        this.visibleDebounceTimer = null
        this.callbacks.onVisibleRoomsChanged(toReport)
      }, VISIBLE_DEBOUNCE_MS)
    }
  }
}
