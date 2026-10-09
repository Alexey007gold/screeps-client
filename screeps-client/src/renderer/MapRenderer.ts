import { Application, Container, Graphics, RenderTexture, Sprite, Text, Texture } from 'pixi.js'
import type { RoomMap2Data, Badge } from 'screeps-connectivity'
import type { MapDecorationRender } from './mapDecorations.js'
import { BadgeTextureCache } from './BadgeTextureCache.js'
import { MapVisualLayer } from './MapVisualLayer.js'
import { ContextRecovery } from './ContextRecovery.js'
import { sharedAtlasCache } from './AtlasCache.js'
import { defaultSpriteTheme } from './themes/default.js'
import { parseRoomName, formatRoomName } from '~/utils/roomName.js'
import { getTerrainCacheBlob, saveTerrainCacheBlob, blobToImageBitmap, terrainCacheScope } from './terrainCache.js'
import { SECTOR_MAX_ROOM_SCREEN_PX } from './sectorTerrain.js'
import { SectorTerrainLayer, expandToSectors } from './SectorTerrainLayer.js'
import { resolveDecorationAssetUrl } from './decorationTextures.js'
import TerrainWorker from './terrain.worker.ts?worker'
import { TERRAIN_WALL, TERRAIN_BORDER } from '~/renderer/colors.js'
import {
  MINIMAP_TILE, MINIMAP_ROAD, MINIMAP_WALLS_OWN, MINIMAP_WALLS_FOREIGN,
  MINIMAP_USER_OWN, MINIMAP_USER_FOREIGN, MAP2_DOT_FEATURES, MAP2_FIXED_KEYS,
} from '~/renderer/minimap.js'
import { createLogger } from '~/utils/log.js'

const { warn } = createLogger('MapRenderer')
import type { MapOverlayMode } from '~/stores/mapOverlayStore.js'

export const MAP_TILE_SIZE = MINIMAP_TILE
export const MAP_ROOM_SIZE = MAP_TILE_SIZE * 50  // 150px per room

// Screen pixel size for each control level (1–8) at zoom = 1.
// Adjust these values to tweak how large badges appear per level.
export const BADGE_SIZES = [50, 60, 70, 80, 90, 100, 105, 120]

// Terrain baked to a GPU texture — two LOD tiers to avoid upscaling blur.
// LOD 0 (zoom < 1): zoomed out, many rooms, small texture fine
// LOD 1 (zoom ≥ 1): zoomed in, crisp at native and above
// LOD_TEXTURE_SIZES moved to worker
const LOD_ZOOM_THRESHOLD = 1
const SECTOR_MODE = -1
export const NAME_ZOOM_THRESHOLD = 0.5
// Rooms within this many cells beyond the visible viewport are kept in memory (scroll buffer)
const CLEAR_PADDING = 50
const OWNER_FADE_MS = 200
const POOL_SIZE = 2600 // max visible rooms plus padding
// Wait this long after the last viewport change before firing onVisibleRoomsChanged
const VISIBLE_DEBOUNCE_MS = 5
// Same, for onCenterChanged — longer, because it ends up in the address bar.
const CENTER_DEBOUNCE_MS = 250

const MIN_ZOOM = 0.1
const MAX_ZOOM = 5

// Minimap dot/terrain palette + dot spec live in ~/renderer/minimap.js (shared
// with the terrain worker and the Overview room-preview tiles).

const MINERAL_WORLD_SIZES = [80, 104, 128, 160] // world-space px per density — scales naturally with zoom

// Alliance overlay: a translucent room tint plus the abbreviation. Below this zoom
// a room is too small for the label to be anything but clutter — the tint carries
// the signal on its own.
const ALLIANCE_LABEL_ZOOM_THRESHOLD = 0.3
const ALLIANCE_FILL_ALPHA = 0.3
// World-space gap between the label baseline and the room's bottom edge.
const ALLIANCE_LABEL_MARGIN = 5

interface RoomEntry {
  container: Container
  terrainSprite: Sprite
  texLo: RenderTexture | null  // LOD 0
  texHi: RenderTexture | null  // LOD 1
  lodGen: number
  lodBaking: [number, number]
  map2Graphics: Graphics
  ownerOverlay: Graphics
  ownerState: 'none' | 'own' | 'other' | 'prohibited'
  lastMap2Data?: Partial<RoomMap2Data>
  lastMap2Source?: 'cache' | 'live'
  badgeSprite?: Sprite
  badgeLevel?: number
  badgeKey?: string
  nameLabel: Text
  allianceOverlay?: Graphics
  allianceLabel?: Text
  /** `abbreviation:color` of what's currently drawn, '' for none — skips redundant redraws. */
  allianceKey?: string
  mineralSprite?: Sprite
  mineralType?: string
  mineralDensity?: number
  roadColor?: number
}

export interface MapRendererCallbacks {
  onRoomHover: (room: string | null) => void
  onRoomClick: (room: string) => void
  onVisibleRoomsChanged: (rooms: string[], zoom: number) => void
  onZoomChanged?: (zoom: number) => void
  /**
   * Viewport centre in room units (a whole number is a room corner, `.5` its
   * centre), debounced so a drag reports once it settles rather than per frame.
   */
  onCenterChanged?: (center: { x: number; y: number }) => void
}

export class MapRenderer {
  readonly app: Application
  private world!: Container
  private boundsGraphics: Graphics | null = null
  private selectionGraphics: Graphics | null = null
  private safeModeGraphics: Graphics | null = null
  private mapVisualLayer: MapVisualLayer | null = null
  private readonly safeModeRooms = new Set<string>()
  private readonly activeRooms = new Map<string, RoomEntry>()
  private readonly roomPool: RoomEntry[] = []
  private readonly terrainBaked = new Set<string>()
  private readonly terrainData  = new Map<string, Uint8Array>()  // raw bytes kept until texHi is baked
  private readonly fadingOverlays = new Set<Graphics>()
  private readonly roomDecorations = new Map<string, MapDecorationRender>()
  private showDecorations = true
  private worker: Worker
  private pendingBakes = new Map<number, { roomName: string, lod: number, resolve: (bmp: ImageBitmap | null) => void, reject: (err: unknown) => void }>()
  private readonly sectorLayer: SectorTerrainLayer
  private sectorsDirty = false
  private nextBakeId = 0
  public currentShard: string = 'shard0'
  private readonly callbacks: MapRendererCallbacks
  private resizeObserver: ResizeObserver | null = null
  private contextRecovery: ContextRecovery | null = null
  private _destroyed = false
  private showRoomNames = false
  private worldBoundsSet: { minX: number; maxX: number; minY: number; maxY: number } | null = null
  private lastVisibleBounds: { rxMin: number; rxMax: number; ryMin: number; ryMax: number } | null = null

  private animTargetX = 0
  private animTargetY = 0
  private isAnimating = false

  private overlayMode: MapOverlayMode = 'owner'
  private showUnclaimableOverlay = true
  private isDragging = false
  private hasDragged = false
  private dragStartX = 0
  private dragStartY = 0
  private dragWorldX = 0
  private dragWorldY = 0
  private isPinching = false
  private pinchPivotWorldX = 0
  private pinchPivotWorldY = 0
  private pinchStartDist = 0
  private pinchStartScale = 0
  private lastVisibleKey = ''
  private visibleRoomNames: string[] = []
  private lastTerrainMode: number | null = null
  private visibleDebounceTimer: ReturnType<typeof setTimeout> | null = null
  // Wheel events fire at native OS rate (WebKit dispatches trackpad scroll/pinch
  // uncoalesced, far faster than Chromium's rAF-aligned coalescing), so raw per-event
  // work here can outpace the frame budget on Safari/Tauri. Batch to one zoom per frame.
  private pendingWheelFactor: number | null = null
  private pendingWheelPivotX = 0
  private pendingWheelPivotY = 0
  private wheelRafId: number | null = null
  private centerDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private selectedRoom: string | null = null
  private currentUserId: string | null = null
  private readonly badgeCache = new BadgeTextureCache()

  constructor(callbacks: MapRendererCallbacks) {
    this.app = new Application()
    this.callbacks = callbacks
    this.sectorLayer = new SectorTerrainLayer({
      roomSize: MAP_ROOM_SIZE,
      isRoomFetched: (room) => this.terrainBaked.has(room),
      roomTerrain: (room) => this.terrainData.get(room) ?? null,
      worldBounds: () => this.worldBoundsSet,
      cacheScope: () => terrainCacheScope(this.currentShard),
      bake: (raws, scope, cacheName) => this.bakeSectorBitmap(raws, scope, cacheName),
    })
    this.worker = new TerrainWorker()
    this.worker.onmessage = (e) => {
      const d = e.data
      if (d.kind === 'cache') {
        // Cache copy encoded by the worker; persist the bytes (cheap, async).
        saveTerrainCacheBlob(d.scope, d.roomName, d.lod, new Blob([d.cacheBytes], { type: d.cacheType || 'image/webp' }))
        return
      }
      const pending = this.pendingBakes.get(d.id)
      if (pending) {
        this.pendingBakes.delete(d.id)
        pending.resolve(d.bitmap)
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

    // All of this renderer's textures (baked terrain bitmaps, badges) are CPU-backed
    // and self-heal automatically once the context is restored — this just pauses the
    // ticker while the context is down so nothing spams draw calls at a dead context.
    this.contextRecovery = new ContextRecovery(this.app, () => {})

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

    this.world.addChild(this.sectorLayer.container)

    this.boundsGraphics = new Graphics()
    this.world.addChild(this.boundsGraphics)

    this.selectionGraphics = new Graphics()
    this.world.addChild(this.selectionGraphics)

    this.safeModeGraphics = new Graphics()
    this.world.addChild(this.safeModeGraphics)

    this.mapVisualLayer = new MapVisualLayer()
    this.world.addChild(this.mapVisualLayer.container)

    this.setupInteraction()
    this.app.ticker.add((ticker) => {
      for (const g of this.fadingOverlays) {
        g.alpha = Math.min(1, g.alpha + ticker.deltaMS / OWNER_FADE_MS)
        if (g.alpha >= 1) this.fadingOverlays.delete(g)
      }
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
      if (this.sectorsDirty) {
        this.sectorsDirty = false
        if (this.sectorMode && this.lastVisibleBounds) this.sectorLayer.update(this.lastVisibleBounds)
      }
    })
  }

  private get sectorMode(): boolean {
    return MAP_ROOM_SIZE * this.zoom < SECTOR_MAX_ROOM_SCREEN_PX
  }

  get zoom(): number {
    return this.world?.scale.x ?? 1
  }

  setZoom(next: number): void {
    if (!this.world) return
    next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next))
    if (next === this.world.scale.x) return
    const cx = this.app.screen.width / 2
    const cy = this.app.screen.height / 2
    this.applyZoomAt(next, cx, cy)
  }

  private applyZoomAt(next: number, pivotScreenX: number, pivotScreenY: number): void {
    const scale = this.world.scale.x
    const prevAboveLOD = this.zoom >= LOD_ZOOM_THRESHOLD
    const prevAboveName = this.zoom >= NAME_ZOOM_THRESHOLD

    const wx = (pivotScreenX - this.world.x) / scale
    const wy = (pivotScreenY - this.world.y) / scale
    this.world.scale.set(next)
    this.world.x = pivotScreenX - wx * next
    this.world.y = pivotScreenY - wy * next

    if ((next >= LOD_ZOOM_THRESHOLD) !== prevAboveLOD || (next >= NAME_ZOOM_THRESHOLD) !== prevAboveName) this.updateAllNameLabels()
    this.updateAllRoomScales(next)
    this.callbacks.onZoomChanged?.(next)
    this.setSelectedRoom(this.selectedRoom)
    this.redrawSafeMode()
  }

  // Viewport centre in room units — the inverse of centerOnPoint, and what the
  // /map URL carries so a bookmarked view comes back to the same place.
  get center(): { x: number; y: number } {
    const scale = this.world?.scale.x ?? 1
    return {
      x: (this.app.screen.width / 2 - (this.world?.x ?? 0)) / scale / MAP_ROOM_SIZE,
      y: (this.app.screen.height / 2 - (this.world?.y ?? 0)) / scale / MAP_ROOM_SIZE,
    }
  }

  centerOn(rx: number, ry: number, animated = false): void {
    this.centerOnPoint(rx + 0.5, ry + 0.5, animated)
  }

  // Centre on an arbitrary point in room units, so a position between rooms
  // (as restored from the URL) survives a round trip unchanged.
  centerOnPoint(x: number, y: number, animated = false): void {
    const cx = x * MAP_ROOM_SIZE
    const cy = y * MAP_ROOM_SIZE
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


  /**
   * The bake worker fetches decoration textures itself, but it cannot reach the
   * Tauri HTTP plugin (no `__TAURI_INTERNALS__` in workers), so its S3 requests
   * would die on WebView CORS. Swapping the URLs for main-thread-resolved blob:
   * URLs here keeps the worker's fetch path unchanged. A URL that fails to
   * resolve is passed through as-is: the worker treats a failed texture load as
   * a missing texture, same as before.
   */
  private async resolveDecorationUrls(decoration: MapDecorationRender): Promise<MapDecorationRender> {
    const resolve = async <T extends { url: string }>(item: T): Promise<T> =>
      ({ ...item, url: await resolveDecorationAssetUrl(item.url).catch(() => item.url) })
    const [overlays, graffiti] = await Promise.all([
      Promise.all(decoration.overlays.map(resolve)),
      Promise.all(decoration.graffiti.map(resolve)),
    ])
    return { ...decoration, overlays, graffiti }
  }

  private async getTerrainBitmap(roomName: string, lod: number, raw: Uint8Array, decoration?: MapDecorationRender): Promise<ImageBitmap | null> {
    const scope = terrainCacheScope(this.currentShard)
    try {
      // Only hit the bitmap cache when using default colors — decorated bakes
      // must not overwrite the cached default, and we want the default restored
      // from cache instantly when decorations are removed.
      if (!decoration) {
        const cachedBlob = await getTerrainCacheBlob(scope, roomName, lod)
        if (cachedBlob) {
          return await blobToImageBitmap(cachedBlob)
        }
      }

      const id = this.nextBakeId++
      const promise = new Promise<ImageBitmap | null>((resolve, reject) => {
        this.pendingBakes.set(id, { roomName, lod, resolve, reject })
      })
      this.worker.postMessage({ id, roomName, lod, raw, scope, decoration: decoration && await this.resolveDecorationUrls(decoration) })

      return await promise
    } catch (e) {
      warn('error getting terrain bitmap:', e)
      return null
    }
  }

  async setRoomTerrain(roomName: string, terrain: { raw: Uint8Array }): Promise<void> {
    const raw = terrain.raw

    // Empty rooms (all-zero terrain) have no content — skip rendering entirely.
    // Mark as baked so hasRoom() returns true and we don't request terrain again.
    let hasContent = false
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== 0) { hasContent = true; break }
    }
    this.sectorsDirty = true
    if (!hasContent) {
      this.terrainBaked.add(roomName)
      return
    }

    const entry = this.getOrCreate(roomName)

    const lod = this.getLOD()

    // Keep raw bytes so the *other* LOD can be baked lazily later, in either
    // zoom direction — the zoom (and thus the target LOD) may even change while
    // this bake is in flight.
    this.terrainData.set(roomName, raw)

    if (this.sectorMode) {
      this.terrainBaked.add(roomName)
      entry.container.visible = true
      return
    }

    const decoration = this.showDecorations ? this.roomDecorations.get(roomName) : undefined
    const gen = entry.lodGen
    const bitmap = await this.getTerrainBitmap(roomName, lod, raw, decoration)
    if (!bitmap) return

    // Re-check if room was cleared while we were waiting
    if (this.activeRooms.get(roomName) !== entry) {
      bitmap.close()
      return
    }

    if (entry.lodGen !== gen) {
      bitmap.close()
    } else {
      // skipCache: true — a freshly-baked bitmap is never reused, so without this
      // PixiJS's global Texture.from cache would keep every baked terrain texture
      // (and its backing pixel buffer) alive forever, even after destroy(true).
      const tex = Texture.from(bitmap, true)

      if (lod === 0) {
        if (entry.texLo && !entry.texLo.destroyed) {
          // Guard: if sprite still references the old texture, clear it before destroying
          // to avoid rendering a texture with a null source (crash on alphaMode read).
          if ((entry.terrainSprite.texture as unknown) === entry.texLo) entry.terrainSprite.texture = Texture.EMPTY
          entry.texLo.destroy(true)
        }
        entry.texLo = tex as unknown as RenderTexture
      } else {
        if (entry.texHi && !entry.texHi.destroyed) {
          if ((entry.terrainSprite.texture as unknown) === entry.texHi) entry.terrainSprite.texture = Texture.EMPTY
          entry.texHi.destroy(true)
        }
        entry.texHi = tex as unknown as RenderTexture
      }
    }

    this.terrainBaked.add(roomName)

    // Apply the texture for whatever LOD is current *now*. If the zoom changed
    // while baking, we just baked the other LOD's texture; ensureCurrentLod
    // bakes the missing one from the kept raw bytes so the room is never blank.
    void this.ensureCurrentLod(roomName, entry)
    entry.container.visible = true
  }


  private getLOD(): number {
    return this.zoom < LOD_ZOOM_THRESHOLD ? 0 : 1
  }


  // Make the room's sprite show the texture for the *current* LOD, baking it
  // from the kept raw bytes if that LOD hasn't been baked yet. Used after a bake
  // (the zoom may have changed mid-flight) and whenever the LOD changes. Returns
  // a promise only when a bake was needed, so callers can await pending work.
  private ensureCurrentLod(roomName: string, entry: RoomEntry): Promise<void> | void {
    if (this.sectorMode) return
    const hi = this.getLOD() === 1
    const have = hi ? entry.texHi : entry.texLo
    if (have && !have.destroyed) {
      entry.terrainSprite.texture = have as unknown as Texture
      return
    }
    const lod = hi ? 1 : 0
    if (entry.lodBaking[lod] === entry.lodGen) return
    const raw = this.terrainData.get(roomName)
    if (!raw) return
    const gen = entry.lodGen
    entry.lodBaking[lod] = gen
    const decoration = this.showDecorations ? this.roomDecorations.get(roomName) : undefined
    return this.getTerrainBitmap(roomName, lod, raw, decoration).then((bitmap) => {
      if (entry.lodBaking[lod] === gen) entry.lodBaking[lod] = -1
      if (!bitmap) return
      if (entry.lodGen !== gen || this.activeRooms.get(roomName) !== entry) { bitmap.close(); return }
      const tex = Texture.from(bitmap, true)
      if (hi) entry.texHi = tex as unknown as RenderTexture
      else entry.texLo = tex as unknown as RenderTexture
      if ((this.getLOD() === 1) === hi) entry.terrainSprite.texture = tex
    })
  }

  private applyLOD(): void {
    for (const roomName of this.visibleRoomNames) {
      if (!this.terrainBaked.has(roomName)) continue
      const entry = this.activeRooms.get(roomName)
      if (entry) void this.ensureCurrentLod(roomName, entry)
    }
  }

  private setSectorMode(on: boolean): void {
    this.sectorLayer.container.visible = on
    for (const entry of this.activeRooms.values()) entry.terrainSprite.visible = !on
  }

  private bakeSectorBitmap(raws: (Uint8Array | null)[], scope: string, cacheName: string): Promise<ImageBitmap | null> {
    const id = this.nextBakeId++
    const promise = new Promise<ImageBitmap | null>((resolve, reject) => {
      this.pendingBakes.set(id, { roomName: cacheName, lod: SECTOR_MODE, resolve, reject })
    })
    this.worker.postMessage({ kind: 'sector', id, raws, scope, cacheName })
    return promise
  }



  setRoomMap2(roomName: string, data: Partial<RoomMap2Data>, source: 'cache' | 'live' = 'live'): void {
    const entry = this.getOrCreate(roomName)
    entry.lastMap2Data = data
    entry.lastMap2Source = source
    this.drawMap2(entry, data, source)
  }

  private drawMap2(entry: RoomEntry, data: Partial<RoomMap2Data>, source: 'cache' | 'live'): void {
    const g = entry.map2Graphics
    g.alpha = source === 'cache' ? 0.6 : 1.0
    const MT = MAP_TILE_SIZE
    g.clear()

    // Roads — same color as TERRAIN_ROAD, small rect
    const roads = data.r ?? []
    for (const [x, y] of roads) {
      g.rect(x * MT, y * MT, MT, MT)
    }
    if (roads.length) g.fill(this.showDecorations ? entry.roadColor ?? MINIMAP_ROAD : MINIMAP_ROAD)

    // Player-built walls / ramparts — color depends on room ownership
    const walls = data.w ?? []
    for (const [x, y] of walls) {
      g.rect(x * MT + 0.5, y * MT + 0.5, MT - 1, MT - 1)
    }
    if (walls.length) g.fill(entry.ownerState === 'other' || entry.ownerState === 'prohibited' ? MINIMAP_WALLS_FOREIGN : MINIMAP_WALLS_OWN)

    // Point features (sources, controllers, minerals, keepers, power banks, deposits) — dots
    for (const feat of MAP2_DOT_FEATURES) {
      const positions = data[feat.key] ?? []
      for (const [x, y] of positions) {
        g.circle((x + 0.5) * MT, (y + 0.5) * MT, feat.radius)
      }
      if (positions.length) g.fill(feat.color)
    }

    // User objects — green for current user, muted red for others
    const dataRec = data as Record<string, [number, number][]>
    for (const key in dataRec) {
      if (MAP2_FIXED_KEYS.has(key)) continue
      const positions = dataRec[key]
      if (!Array.isArray(positions)) continue
      if (positions.length === 0) continue
      for (const [x, y] of positions) {
        g.circle((x + 0.5) * MT, (y + 0.5) * MT, 1.0)
      }
      const color = key === this.currentUserId ? MINIMAP_USER_OWN : MINIMAP_USER_FOREIGN
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

  setRoomOwned(roomName: string, state: 'none' | 'own' | 'other' | 'prohibited'): void {
    const entry = this.activeRooms.get(roomName)
    if (!entry) return
    const g = entry.ownerOverlay
    if (entry.ownerState !== state) {
      entry.ownerState = state
      if (entry.lastMap2Data) this.drawMap2(entry, entry.lastMap2Data, entry.lastMap2Source ?? 'live')
      if (entry.container.visible) {
        g.alpha = 0
        this.fadingOverlays.add(g)
      }
    }
    g.clear()
    if (state === 'prohibited') {
      g.rect(0, 0, MAP_ROOM_SIZE, MAP_ROOM_SIZE)
      g.fill({ color: 0x000000, alpha: 0.5 })
    } else if (state === 'other') {
      g.rect(0, 0, MAP_ROOM_SIZE, MAP_ROOM_SIZE)
      g.fill({ color: 0x990000, alpha: 0.18 })
    } else if (state === 'own') {
      g.rect(0, 0, MAP_ROOM_SIZE, MAP_ROOM_SIZE)
      g.fill({ color: 0x000066, alpha: 0.35 })
    }
    g.visible = this.ownerOverlayVisible(entry)
  }

  /**
   * The unclaimable wash is suppressed in alliance mode — a red tint over every
   * foreign room would drown out the alliance colours. Out-of-borders stays
   * shaded regardless: it marks territory that doesn't exist.
   */
  private ownerOverlayVisible(entry: RoomEntry): boolean {
    if (entry.ownerState === 'prohibited') return true
    return this.showUnclaimableOverlay && this.overlayMode !== 'alliance'
  }

  setUnclaimableOverlayVisible(show: boolean): void {
    if (this.showUnclaimableOverlay === show) return
    this.showUnclaimableOverlay = show
    for (const entry of this.activeRooms.values()) {
      entry.ownerOverlay.visible = this.ownerOverlayVisible(entry)
    }
  }

  setRoomDecoration(roomName: string, decoration: MapDecorationRender | undefined): void {
    const current = this.roomDecorations.get(roomName)
    // Only re-bake when something actually changed.
    const newKey = decoration ? JSON.stringify(decoration) : ''
    const oldKey = current ? JSON.stringify(current) : ''
    if (newKey === oldKey) return

    if (decoration) this.roomDecorations.set(roomName, decoration)
    else this.roomDecorations.delete(roomName)

    this.rebakeRoom(roomName)
  }

  setDecorationsVisible(show: boolean): void {
    if (this.showDecorations === show) return
    this.showDecorations = show
    // Re-bake every room that has a stored decoration.
    for (const roomName of this.roomDecorations.keys()) {
      this.rebakeRoom(roomName)
    }
  }

  private rebakeRoom(roomName: string): void {
    const entry = this.activeRooms.get(roomName)
    if (!entry) return

    // Roads live in the map2 overlay, not the baked terrain, so their colour is
    // re-applied separately.
    const road = this.roomDecorations.get(roomName)?.colors.road
    entry.roadColor = road != null ? parseInt(road.replace('#', ''), 16) : undefined
    if (entry.lastMap2Data) this.drawMap2(entry, entry.lastMap2Data, entry.lastMap2Source ?? 'live')

    // Destroy both LOD textures so ensureCurrentLod re-bakes from scratch.
    // Colors are looked up internally from roomDecorations.
    entry.lodGen++
    for (const lodKey of ['texLo', 'texHi'] as const) {
      const tex = entry[lodKey]
      if (tex && !tex.destroyed) {
        if ((entry.terrainSprite.texture as unknown) === tex) entry.terrainSprite.texture = Texture.EMPTY
        tex.destroy(true)
        entry[lodKey] = null
      }
    }

    void this.ensureCurrentLod(roomName, entry)
  }

  async setRoomBadge(roomName: string, badge?: Badge, level?: number): Promise<void> {
    const entry = this.activeRooms.get(roomName)
    if (!entry) return

    const key = badge ? `${JSON.stringify(badge)}|${level ?? ''}` : ''
    if (entry.badgeKey === key) return
    entry.badgeKey = key

    if (!badge) {
      if (entry.badgeSprite) {
        entry.container.removeChild(entry.badgeSprite)
        entry.badgeSprite.destroy()
        entry.badgeSprite = undefined
      }
      entry.badgeLevel = undefined
      return
    }

    try {
      const texture = await this.badgeCache.getOrCreate(badge)
      if (this.activeRooms.get(roomName) !== entry || entry.badgeKey !== key) return

      if (entry.badgeSprite) {
        entry.badgeSprite.texture = texture
      } else {
        const sprite = new Sprite(texture)
        sprite.anchor.set(0.5)
        sprite.x = MAP_ROOM_SIZE / 2
        sprite.y = MAP_ROOM_SIZE / 2
        entry.container.addChildAt(sprite, this.decorInsertIndex(entry))
        entry.badgeSprite = sprite
      }

      entry.badgeLevel = level
      this.applyBadgeSize(entry, this.zoom)
      this.applyOverlayMode(entry)
    } catch (err) {
      if (entry.badgeKey === key) entry.badgeKey = undefined
      warn('failed to load badge for', roomName, err)
    }
  }

  private applyBadgeSize(entry: RoomEntry, zoom: number): void {
    if (!entry.badgeSprite || entry.badgeLevel === undefined) return
    const base = BADGE_SIZES[entry.badgeLevel - 1] ?? 24
    // Scale with zoom up to 100%, then stay constant.
    const screenSize = base * Math.min(1, zoom)
    entry.badgeSprite.width = screenSize / zoom
    entry.badgeSprite.height = screenSize / zoom
  }

  setOverlayMode(mode: MapOverlayMode): void {
    if (this.overlayMode === mode) return
    this.overlayMode = mode
    for (const entry of this.activeRooms.values()) {
      this.applyOverlayMode(entry)
    }
  }

  setRoomMineral(roomName: string, mineral?: string, density?: number): void {
    const entry = this.activeRooms.get(roomName)
    if (!entry) return

    if (!mineral || !density) {
      if (entry.mineralSprite) {
        entry.container.removeChild(entry.mineralSprite)
        entry.mineralSprite.destroy()
        entry.mineralSprite = undefined
      }
      entry.mineralType = undefined
      entry.mineralDensity = undefined
      return
    }

    entry.mineralDensity = density

    if (!entry.mineralSprite || entry.mineralType !== mineral) {
      if (entry.mineralSprite) {
        entry.container.removeChild(entry.mineralSprite)
        entry.mineralSprite.destroy()
      }
      const frame = `mineral/${mineral}`
      const sprite = new Sprite()
      sprite.anchor.set(0.5)
      sprite.x = MAP_ROOM_SIZE / 2
      sprite.y = MAP_ROOM_SIZE / 2
      entry.container.addChildAt(sprite, this.decorInsertIndex(entry))
      entry.mineralSprite = sprite
      entry.mineralType = mineral

      const tex = sharedAtlasCache.getTexture(defaultSpriteTheme.atlasUrl, frame)
      if (tex) {
        sprite.texture = tex
      } else {
        sharedAtlasCache.getOrLoad(defaultSpriteTheme.atlasUrl).then(sheet => {
          if (!sprite.destroyed) sprite.texture = sheet.textures[frame] ?? Texture.EMPTY
        }).catch(() => {})
      }
    }

    this.applyMineralSize(entry, this.zoom)
    this.applyOverlayMode(entry)
  }

  /**
   * Tint a room in its owner's alliance colour. `null` clears it — which is also
   * what an unowned room, an unaligned owner, or a roster that hasn't loaded gets.
   */
  setRoomAlliance(roomName: string, alliance: { abbreviation: string; color: number } | null): void {
    const entry = this.activeRooms.get(roomName)
    if (!entry) return

    const key = alliance ? `${alliance.abbreviation}:${alliance.color}` : ''
    if (entry.allianceKey === key) return

    if (!alliance) {
      this.releaseAllianceVisuals(entry)
      return
    }
    entry.allianceKey = key

    // The tint goes straight above the unclaimable wash so the owner badge, the
    // mineral icon and the labels all stay readable on top of it.
    if (!entry.allianceOverlay) {
      const g = new Graphics()
      entry.container.addChildAt(g, entry.container.getChildIndex(entry.ownerOverlay) + 1)
      entry.allianceOverlay = g
    }
    const g = entry.allianceOverlay
    g.clear()
    g.rect(0, 0, MAP_ROOM_SIZE, MAP_ROOM_SIZE)
    g.fill({ color: alliance.color, alpha: ALLIANCE_FILL_ALPHA })
    g.rect(0, 0, MAP_ROOM_SIZE, MAP_ROOM_SIZE)
    // alignment: 1 = inner stroke, so neighbouring alliance rooms read as one block.
    g.stroke({ color: alliance.color, width: 4, alignment: 1, alpha: 0.85 })

    if (!entry.allianceLabel) {
      const t = new Text({
        text: '',
        style: {
          fontSize: 36,
          fill: 0xffffff,
          fontFamily: 'ui-monospace, monospace',
          fontWeight: 'bold',
          stroke: { color: 0x000000, width: 5 },
        },
      })
      // Bottom edge, centred — the badge owns the middle of the room.
      t.anchor.set(0.5, 1)
      t.x = MAP_ROOM_SIZE / 2
      t.y = MAP_ROOM_SIZE - ALLIANCE_LABEL_MARGIN
      entry.container.addChildAt(t, entry.container.getChildIndex(entry.nameLabel))
      entry.allianceLabel = t
    }
    entry.allianceLabel.text = alliance.abbreviation
    entry.allianceLabel.style.fill = alliance.color

    this.applyAllianceLabel(entry, this.zoom)
    this.applyOverlayMode(entry)
  }

  private releaseAllianceVisuals(entry: RoomEntry): void {
    if (entry.allianceOverlay) {
      entry.container.removeChild(entry.allianceOverlay)
      entry.allianceOverlay.destroy()
      entry.allianceOverlay = undefined
    }
    if (entry.allianceLabel) {
      entry.container.removeChild(entry.allianceLabel)
      entry.allianceLabel.destroy()
      entry.allianceLabel = undefined
    }
    entry.allianceKey = ''
  }

  private applyAllianceLabel(entry: RoomEntry, zoom: number): void {
    const label = entry.allianceLabel
    if (!label) return
    // Same shape as the room-name scale: √zoom growth with a screen-pixel floor.
    const MIN_PX = 13
    label.scale.set(Math.max(0.42 / Math.sqrt(zoom), MIN_PX / (36 * zoom)))
    label.visible = this.overlayMode === 'alliance' && zoom >= ALLIANCE_LABEL_ZOOM_THRESHOLD
  }

  /**
   * Where badges and mineral icons go in the child list: below the alliance label
   * (so the abbreviation is never covered), above everything else. Arrival order of
   * badge vs. alliance data varies per room, so the index is derived, not assumed.
   */
  private decorInsertIndex(entry: RoomEntry): number {
    return entry.container.getChildIndex(entry.allianceLabel ?? entry.nameLabel)
  }

  private applyOverlayMode(entry: RoomEntry): void {
    if (entry.badgeSprite) {
      // Badges stay up in alliance mode — the tint says which alliance, the badge
      // still says which player.
      entry.badgeSprite.visible = this.overlayMode === 'owner' || this.overlayMode === 'alliance'
    }
    if (entry.mineralSprite) {
      entry.mineralSprite.visible = this.overlayMode === 'mineral'
    }
    if (entry.allianceOverlay) {
      entry.allianceOverlay.visible = this.overlayMode === 'alliance'
    }
    if (entry.allianceLabel) {
      entry.allianceLabel.visible = this.overlayMode === 'alliance' && this.zoom >= ALLIANCE_LABEL_ZOOM_THRESHOLD
    }
    entry.ownerOverlay.visible = this.ownerOverlayVisible(entry)
  }

  private applyMineralSize(entry: RoomEntry, zoom: number): void {
    if (!entry.mineralSprite || entry.mineralDensity === undefined) return
    const baseWorld = MINERAL_WORLD_SIZES[entry.mineralDensity - 1] ?? 52
    const minWorld = 14 / zoom  // floor: sprite stays at least 14px on screen at any zoom
    const worldSize = Math.max(baseWorld, minWorld)
    entry.mineralSprite.width = worldSize
    entry.mineralSprite.height = worldSize
  }

  private updateNameLabelScale(entry: RoomEntry, zoom: number): void {
    // Desired: screen size grows with sqrt(zoom) so text shrinks relative to room tiles when zoomed out.
    // Clamped at 12px minimum so it stays readable down to NAME_ZOOM_THRESHOLD.
    // Crossover: below zoom ≈ 1.24 the 12px floor applies; above it sqrt(zoom) takes over.
    const MIN_PX = 12
    const sqrtScale = 0.3 / Math.sqrt(zoom)       // → 10.8·√zoom px on screen
    const minScale  = MIN_PX / (36 * zoom)         // → 12px on screen
    entry.nameLabel.scale.set(Math.max(sqrtScale, minScale))
  }

  // Combine zooming scaling operations over activeRooms to reduce overhead on every zoom frame
  // Avoid intermediate allocations by using for...of map.values()
  private updateAllRoomScales(zoom: number): void {
    for (const entry of this.activeRooms.values()) {
      this.applyBadgeSize(entry, zoom)
      this.updateNameLabelScale(entry, zoom)
      this.applyMineralSize(entry, zoom)
      this.applyAllianceLabel(entry, zoom)
    }
  }

  setCurrentUser(userId: string | null): void {
    this.currentUserId = userId
  }

  setMapVisual(raw: string): void {
    this.mapVisualLayer?.update(raw)
    // Keep mapVisualLayer on top of all other overlays
    if (this.mapVisualLayer) {
      this.world.removeChild(this.mapVisualLayer.container)
      this.world.addChild(this.mapVisualLayer.container)
    }
  }

  clearMapVisual(): void {
    this.mapVisualLayer?.clear()
  }

  setMapVisualVisible(show: boolean): void {
    if (this.mapVisualLayer) this.mapVisualLayer.container.visible = show
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

  markRoomFetched(roomName: string): void {
    this.terrainBaked.add(roomName)
  }


  clearRoom(roomName: string): void {
    const entry = this.activeRooms.get(roomName)
    if (!entry) return
    if (entry.texLo && !entry.texLo.destroyed) entry.texLo.destroy(true)
    if (entry.texHi && !entry.texHi.destroyed) entry.texHi.destroy(true)
    entry.texLo = null
    entry.texHi = null
    entry.lodGen++
    entry.terrainSprite.texture = Texture.EMPTY
    entry.map2Graphics.clear()
    entry.ownerOverlay.clear()
    entry.ownerOverlay.alpha = 1
    entry.ownerState = 'none'
    this.fadingOverlays.delete(entry.ownerOverlay)
    if (entry.badgeSprite) {
      entry.container.removeChild(entry.badgeSprite)
      entry.badgeSprite.destroy()
      entry.badgeSprite = undefined
    }
    entry.badgeKey = undefined
    if (entry.mineralSprite) {
      entry.container.removeChild(entry.mineralSprite)
      entry.mineralSprite.destroy()
      entry.mineralSprite = undefined
    }
    entry.mineralType = undefined
    entry.mineralDensity = undefined
    this.releaseAllianceVisuals(entry)
    entry.container.visible = false
    this.safeModeRooms.delete(roomName)

    this.terrainBaked.delete(roomName)
    this.terrainData.delete(roomName)
    this.roomDecorations.delete(roomName)
    this.activeRooms.delete(roomName)

    // Return to pool if not too big, else destroy
    if (this.roomPool.length < POOL_SIZE) {
      this.roomPool.push(entry)
    } else {
      this.world.removeChild(entry.container)
      entry.container.destroy({ children: true, context: true })
    }
  }


  // Force every currently active room to be torn down and re-fetched — used
  // when the shard changes, since terrainBaked/terrainData/activeRooms are all
  // keyed by room name alone and room names collide across shards (e.g. every
  // shard has a "W5N5"). Without this, hasRoom() keeps reporting the old
  // shard's terrain as already loaded and the new shard's terrain never fetches.
  clearAllRooms(): void {
    for (const name of [...this.activeRooms.keys()]) {
      this.clearRoom(name)
    }
    this.terrainBaked.clear()
    this.sectorLayer.clear()
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
    if (b) this.sectorLayer.evictOutside(b, CLEAR_PADDING)
  }

  destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.contextRecovery?.dispose()
    this.contextRecovery = null
    if (this.visibleDebounceTimer !== null) {
      clearTimeout(this.visibleDebounceTimer)
      this.visibleDebounceTimer = null
    }
    if (this.wheelRafId !== null) {
      cancelAnimationFrame(this.wheelRafId)
      this.wheelRafId = null
    }
    if (this.centerDebounceTimer !== null) {
      clearTimeout(this.centerDebounceTimer)
      this.centerDebounceTimer = null
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
    this.sectorLayer.clear()
    this.terrainBaked.clear()
    this.terrainData.clear()
    this.fadingOverlays.clear()
    this.roomDecorations.clear()
    this.worker.terminate()
    this.pendingBakes.clear()
    this.badgeCache.destroy()
    this.mapVisualLayer?.destroy()
    this.mapVisualLayer = null
    try {
      // NOT texture:true — terrain textures are already destroyed manually above,
      // and texture:true would also destroy the globally shared Texture.EMPTY that
      // every empty/unbaked terrainSprite references. That corrupts EMPTY for the
      // next MapRenderer instance and crashes on render (source.style === null →
      // "addressModeU of null"), most visibly when zoomed far out (many EMPTY tiles).
      this.app.destroy(false, { children: true, context: true })
    } catch (e) {
      warn('destroy error (ignored):', e)
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
      terrainSprite.width  = MAP_ROOM_SIZE
      terrainSprite.height = MAP_ROOM_SIZE
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

      entry = { container, terrainSprite, texLo: null, texHi: null, lodGen: 0, lodBaking: [-1, -1], map2Graphics, ownerOverlay, ownerState: 'none', nameLabel }
    }

    entry.container.x = coord.x * MAP_ROOM_SIZE
    entry.container.y = coord.y * MAP_ROOM_SIZE
    entry.container.visible = false
    entry.terrainSprite.visible = !this.sectorMode
    entry.nameLabel.text = roomName
    entry.nameLabel.visible = this.showRoomNames && this.zoom >= NAME_ZOOM_THRESHOLD && this.nameLabelShouldShow(coord.x, coord.y)
    this.updateNameLabelScale(entry, this.zoom)

    // Reset pooled badge sprite so a stale badge from a previous room doesn't leak through
    if (entry.badgeSprite) {
      entry.container.removeChild(entry.badgeSprite)
      entry.badgeSprite.destroy()
      entry.badgeSprite = undefined
    }

    // Reset pooled mineral sprite
    if (entry.mineralSprite) {
      entry.container.removeChild(entry.mineralSprite)
      entry.mineralSprite.destroy()
      entry.mineralSprite = undefined
    }
    entry.mineralType = undefined
    entry.mineralDensity = undefined

    // Reset pooled alliance tint/label so a previous room's alliance doesn't leak through
    this.releaseAllianceVisuals(entry)

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
    const b = this.worldBoundsSet
    if (b && (rx < b.minX || rx > b.maxX || ry < b.minY || ry > b.maxY)) return false
    return true
  }

  private updateAllNameLabels(): void {
    // Hoist the global checks out of the per-room loop
    const globalShow = this.showRoomNames && this.zoom >= NAME_ZOOM_THRESHOLD

    for (const [name, entry] of this.activeRooms) {
      if (!globalShow) {
        entry.nameLabel.visible = false
        continue
      }

      const coord = parseRoomName(name)
      if (!coord) continue
      entry.nameLabel.visible = this.nameLabelShouldShow(coord.x, coord.y)
    }
  }

  private setupInteraction(): void {
    const canvas = this.app.canvas as HTMLCanvasElement
    canvas.style.touchAction = 'none'
    canvas.style.userSelect = 'none'

    const activePointers = new Map<number, { x: number; y: number }>()

    canvas.addEventListener('pointermove', (e) => {
      if (!activePointers.has(e.pointerId)) {
        if (!this.isDragging && !this.isPinching) {
          const rect = canvas.getBoundingClientRect()
          this.emitHover(e.clientX - rect.left, e.clientY - rect.top)
        }
        return
      }

      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (this.isPinching && activePointers.size === 2) {
        const pts = [...activePointers.values()]
        const rect = canvas.getBoundingClientRect()
        const newMidX = (pts[0].x + pts[1].x) / 2 - rect.left
        const newMidY = (pts[0].y + pts[1].y) / 2 - rect.top
        const newDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
        const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.pinchStartScale * (newDist / this.pinchStartDist)))
        const prevAboveLOD = this.zoom >= LOD_ZOOM_THRESHOLD
        const prevAboveName = this.zoom >= NAME_ZOOM_THRESHOLD
        this.world.scale.set(newScale)
        this.world.x = newMidX - this.pinchPivotWorldX * newScale
        this.world.y = newMidY - this.pinchPivotWorldY * newScale
        if ((newScale >= LOD_ZOOM_THRESHOLD) !== prevAboveLOD || (newScale >= NAME_ZOOM_THRESHOLD) !== prevAboveName) this.updateAllNameLabels()
        this.updateAllRoomScales(newScale)
        this.callbacks.onZoomChanged?.(newScale)
        this.setSelectedRoom(this.selectedRoom)
        this.redrawSafeMode()
        return
      }

      if (this.isDragging) {
        const rawDx = e.clientX - this.dragStartX
        const rawDy = e.clientY - this.dragStartY
        if (Math.abs(rawDx) > 3 || Math.abs(rawDy) > 3) this.hasDragged = true
        const b = this.worldBoundsSet
        if (b) {
          const scale = this.world.scale.x
          const MARGIN = 50
          const minX = MARGIN - (b.maxX + 1) * MAP_ROOM_SIZE * scale
          const maxX = this.app.screen.width  - MARGIN - b.minX * MAP_ROOM_SIZE * scale
          const minY = MARGIN - (b.maxY + 1) * MAP_ROOM_SIZE * scale
          const maxY = this.app.screen.height - MARGIN - b.minY * MAP_ROOM_SIZE * scale
          this.world.x = this.rubberBand(this.dragWorldX + rawDx, minX, maxX)
          this.world.y = this.rubberBand(this.dragWorldY + rawDy, minY, maxY)
        } else {
          this.world.x = this.dragWorldX + rawDx
          this.world.y = this.dragWorldY + rawDy
        }
      }
    })

    canvas.addEventListener('pointerleave', () => {
      if (!this.isDragging && !this.isPinching) this.callbacks.onRoomHover(null)
    })

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.isAnimating = false
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      canvas.setPointerCapture(e.pointerId)

      if (activePointers.size >= 2) {
        // Enter pinch mode, cancel single-finger drag
        this.isDragging = false
        this.isPinching = true
        const pts = [...activePointers.values()]
        const rect = canvas.getBoundingClientRect()
        const midX = (pts[0].x + pts[1].x) / 2 - rect.left
        const midY = (pts[0].y + pts[1].y) / 2 - rect.top
        this.pinchStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
        this.pinchStartScale = this.world.scale.x
        this.pinchPivotWorldX = (midX - this.world.x) / this.pinchStartScale
        this.pinchPivotWorldY = (midY - this.world.y) / this.pinchStartScale
      } else {
        this.isPinching = false
        this.isDragging = true
        this.hasDragged = false
        this.dragStartX = e.clientX
        this.dragStartY = e.clientY
        this.dragWorldX = this.world.x
        this.dragWorldY = this.world.y
      }
    })

    canvas.addEventListener('pointerup', (e) => {
      activePointers.delete(e.pointerId)
      canvas.releasePointerCapture(e.pointerId)

      if (this.isPinching) {
        if (activePointers.size < 2) {
          this.isPinching = false
          this.isDragging = false
          this.springBack()
        }
        return
      }

      if (this.isDragging) {
        this.isDragging = false
        if (!this.hasDragged) {
          const rect = canvas.getBoundingClientRect()
          const room = this.screenToRoom(e.clientX - rect.left, e.clientY - rect.top)
          if (room) this.callbacks.onRoomClick(room)
        }
        this.springBack()
      }
    })

    canvas.addEventListener('pointercancel', (e) => {
      activePointers.delete(e.pointerId)
      canvas.releasePointerCapture(e.pointerId)
      if (this.isPinching || this.isDragging) {
        this.isPinching = false
        this.isDragging = false
        this.springBack()
      }
    })

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      if (this.isDragging || this.isPinching) return
      this.isAnimating = false
      const factor = e.deltaY < 0 ? 1.1 : 0.9
      this.pendingWheelFactor = (this.pendingWheelFactor ?? 1) * factor
      this.pendingWheelPivotX = e.offsetX
      this.pendingWheelPivotY = e.offsetY
      if (this.wheelRafId === null) {
        this.wheelRafId = requestAnimationFrame(() => {
          this.wheelRafId = null
          const pending = this.pendingWheelFactor
          this.pendingWheelFactor = null
          if (pending === null) return
          const scale = this.world.scale.x
          const next  = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale * pending))
          this.applyZoomAt(next, this.pendingWheelPivotX, this.pendingWheelPivotY)
        })
      }
    }, { passive: false })
  }

  // iOS-style rubber-band: full movement within [lower, upper], decelerating damping outside.
  private rubberBand(x: number, lower: number, upper: number): number {
    const size = upper - lower
    if (size <= 0) return x
    if (x >= lower && x <= upper) return x
    const c = 0.55
    if (x < lower) {
      const excess = lower - x
      return lower - (1 - 1 / (excess * c / size + 1)) * size * c
    }
    const excess = x - upper
    return upper + (1 - 1 / (excess * c / size + 1)) * size * c
  }

  // After drag: animate world back if the world has been pulled mostly off-screen.
  private springBack(): void {
    const b = this.worldBoundsSet
    if (!b) return
    const scale = this.world.scale.x
    const sw = this.app.screen.width
    const sh = this.app.screen.height
    const MARGIN = 50

    const wl = this.world.x + b.minX * MAP_ROOM_SIZE * scale
    const wr = this.world.x + (b.maxX + 1) * MAP_ROOM_SIZE * scale
    const wt = this.world.y + b.minY * MAP_ROOM_SIZE * scale
    const wb = this.world.y + (b.maxY + 1) * MAP_ROOM_SIZE * scale

    let tx = this.world.x
    let ty = this.world.y

    if (wr < MARGIN)           tx += MARGIN - wr
    else if (wl > sw - MARGIN) tx -= wl - (sw - MARGIN)
    if (wb < MARGIN)           ty += MARGIN - wb
    else if (wt > sh - MARGIN) ty -= wt - (sh - MARGIN)

    if (tx !== this.world.x || ty !== this.world.y) {
      this.animTargetX = tx
      this.animTargetY = ty
      this.isAnimating = true
    }
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

  private lastCheckX = 0
  private lastCheckY = 0
  private lastCheckScale = 0

  private checkVisibleRooms(): void {
    const scale = this.world.scale.x
    const worldX = this.world.x
    const worldY = this.world.y

    if (this.lastCheckX === worldX && this.lastCheckY === worldY && this.lastCheckScale === scale) {
      return
    }

    this.lastCheckX = worldX
    this.lastCheckY = worldY
    this.lastCheckScale = scale

    // Report the centre only once the view settles — this drives a URL rewrite,
    // and browsers rate-limit history updates well below one per frame.
    if (this.callbacks.onCenterChanged) {
      if (this.centerDebounceTimer !== null) clearTimeout(this.centerDebounceTimer)
      this.centerDebounceTimer = setTimeout(() => {
        this.centerDebounceTimer = null
        this.callbacks.onCenterChanged?.(this.center)
      }, CENTER_DEBOUNCE_MS)
    }

    const left   = (-worldX) / scale
    const top    = (-worldY) / scale
    const right  = (this.app.screen.width  - worldX) / scale
    const bottom = (this.app.screen.height - worldY) / scale

    let rxMin = Math.floor(left   / MAP_ROOM_SIZE) - 1
    let rxMax = Math.ceil (right  / MAP_ROOM_SIZE)
    let ryMin = Math.floor(top    / MAP_ROOM_SIZE) - 1
    let ryMax = Math.ceil (bottom / MAP_ROOM_SIZE)
    const sectorMode = this.sectorMode
    if (sectorMode) ({ rxMin, rxMax, ryMin, ryMax } = expandToSectors({ rxMin, rxMax, ryMin, ryMax }))
    this.lastVisibleBounds = { rxMin, rxMax, ryMin, ryMax }

    const visible: string[] = []
    const b = this.worldBoundsSet
    const rxFrom = b ? Math.max(rxMin, b.minX) : rxMin
    const rxTo   = b ? Math.min(rxMax, b.maxX) : rxMax
    const ryFrom = b ? Math.max(ryMin, b.minY) : ryMin
    const ryTo   = b ? Math.min(ryMax, b.maxY) : ryMax
    for (let rx = rxFrom; rx <= rxTo; rx++) {
      for (let ry = ryFrom; ry <= ryTo; ry++) {
        const name = formatRoomName(rx, ry)
        if (name) visible.push(name)
      }
    }

    const key = `${rxMin},${ryMin},${rxMax},${ryMax}`
    const keyChanged = key !== this.lastVisibleKey
    if (keyChanged) {
      this.lastVisibleKey = key
      this.visibleRoomNames = visible
      if (this.visibleDebounceTimer !== null) clearTimeout(this.visibleDebounceTimer)
      this.visibleDebounceTimer = setTimeout(() => {
        this.visibleDebounceTimer = null
        this.callbacks.onVisibleRoomsChanged(visible, scale)
      }, VISIBLE_DEBOUNCE_MS)
    }

    const mode = sectorMode ? SECTOR_MODE : this.getLOD()
    const modeChanged = mode !== this.lastTerrainMode
    if (modeChanged) {
      this.lastTerrainMode = mode
      this.setSectorMode(sectorMode)
    }
    if (keyChanged || modeChanged) {
      if (sectorMode) this.sectorLayer.update(this.lastVisibleBounds)
      else this.applyLOD()
    }
  }
}
