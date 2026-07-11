import { Application, Container, Graphics, RenderTexture, Sprite, Texture } from 'pixi.js'
import type { RoomMap2Data, RoomObjectMap, RoomObjectDiff, RoomTerrain, RoomObject } from 'screeps-connectivity'
import { WorldCamera, type VisibleBounds, type WorldCameraBounds } from './WorldCamera.js'
import { RoomScene, type RoomSceneUpdateOptions } from './RoomScene.js'
import type { RoomDecoration } from './roomDecorations.js'
import type { SelectionVisual } from './HoverHighlightLayer.js'
import { TILE_SIZE } from './RoomRenderer.js'
import { parseRoomName, formatRoomName } from '~/utils/roomName.js'
import { getTerrainCacheBlob, saveTerrainCacheBlob, blobToImageBitmap } from './terrainCache.js'
import TerrainWorker from './terrain.worker.ts?worker'
import { TERRAIN_WALL, TERRAIN_BORDER } from '~/renderer/colors.js'
import {
  MINIMAP_TILE, MINIMAP_ROAD, MINIMAP_WALLS_OWN, MINIMAP_WALLS_FOREIGN,
  MINIMAP_USER_OWN, MINIMAP_USER_FOREIGN, MAP2_DOT_FEATURES, MAP2_FIXED_KEYS,
} from '~/renderer/minimap.js'

// A full room rendered edge-to-edge — matches RoomRenderer's ROOM_SIZE
// (TILE_SIZE=12 * 50 tiles) so Phase 2's full-detail ObjectLayer/TerrainLayer
// can render unscaled inside a cell of this size.
export const ROOM_WORLD_SIZE = 600
// Map2 dots/roads/walls are drawn at this many px per game cell (vs. the
// world map's MINIMAP_TILE=3 for its 150px rooms) — same 1:1 with the room
// view's TILE_SIZE so full-detail objects land exactly where the dots were.
export const MAP2_TILE = 12
const MAP2_DOT_SCALE = MAP2_TILE / MINIMAP_TILE

// Terrain LOD crossover — below this zoom the smaller (128px) baked texture is
// used, matching terrain.worker.ts's LOD_SIZES=[128,512]. Chosen so the 512px
// texture is never upscaled below the full-detail threshold (~0.6): at zoom
// 0.6 a room is 360px on screen, comfortably under 512.
const LOD_ZOOM_THRESHOLD = 0.3

export const MIN_ZOOM = 0.03
export const MAX_ZOOM = 2
// Below this zoom, dispose all map2 subscriptions (too many rooms visible to
// usefully render dots) — mirrors MapViewer's `zoom() >= 0.4` gate.
export const MAP2_MIN_ZOOM = 0.06
// At/above this zoom, the closest rooms swap from the map2 overlay to full
// per-object detail (Phase 2). Room size on screen = ROOM_WORLD_SIZE * zoom,
// so 0.6 → 360px, comfortably larger than the 512px LOD1 texture needs to be.
export const FULL_DETAIL_ZOOM_THRESHOLD = 0.6

// Rooms within this many cells beyond the visible viewport are kept pooled
// rather than torn down immediately (scroll buffer).
const CLEAR_PADDING = 20
const POOL_SIZE = 400

interface CellEntry {
  container: Container
  terrainSprite: Sprite
  texLo: RenderTexture | null // LOD 0 (128px)
  texHi: RenderTexture | null // LOD 1 (512px)
  map2Graphics: Graphics
  ownerState: 'none' | 'own' | 'other' | 'prohibited'
  lastMap2Data?: Partial<RoomMap2Data>
  lastMap2Source?: 'cache' | 'live'
}

export interface MultiRoomRendererCallbacks {
  onRoomHover: (room: string | null) => void
  // Fired for clicks on a room that has no full-detail scene (or whose scene
  // hasn't rendered its first object snapshot yet) — the existing "select the
  // room / second click navigates in" behavior from the map view.
  onRoomClick: (room: string) => void
  // Fired instead of onRoomClick when clicking inside a ready full-detail
  // room — (tx,ty) are tile-local (0..49), matching RoomRenderer's tile space.
  onTileClick: (room: string, tx: number, ty: number, ctrlKey: boolean) => void
  // `inView` is the subset of `rooms` that's actually on screen right now
  // (excludes the scroll-ahead buffer) — lets the full-detail promotion
  // logic prefer truly-visible rooms over buffered-but-off-screen ones.
  onVisibleRoomsChanged: (rooms: string[], inView: ReadonlySet<string>) => void
  onZoomChanged?: (zoom: number) => void
}

export class MultiRoomRenderer {
  readonly app: Application
  private camera!: WorldCamera
  private boundsGraphics: Graphics | null = null
  private readonly activeRooms = new Map<string, CellEntry>()
  private readonly roomScenes = new Map<string, RoomScene>()
  private readonly roomPool: CellEntry[] = []
  private readonly terrainBaked = new Set<string>()
  private readonly terrainData = new Map<string, Uint8Array>() // raw bytes kept for lazy other-LOD bakes
  private worker: Worker
  private pendingBakes = new Map<number, { resolve: (bmp: ImageBitmap) => void, reject: (err: unknown) => void }>()
  private nextBakeId = 0
  public currentShard: string = 'shard0'
  private readonly callbacks: MultiRoomRendererCallbacks
  private resizeObserver: ResizeObserver | null = null
  private _destroyed = false
  private worldBoundsSet: WorldCameraBounds | null = null
  private lastVisibleBounds: VisibleBounds | null = null
  private currentUserId: string | null = null
  private currentLOD = 0
  private hoveredFullDetailRoom: string | null = null

  constructor(callbacks: MultiRoomRendererCallbacks) {
    this.app = new Application()
    this.callbacks = callbacks
    this.worker = new TerrainWorker()
    this.worker.onmessage = (e) => {
      const d = e.data
      if (d.kind === 'cache') {
        saveTerrainCacheBlob(d.shard, d.roomName, d.lod, new Blob([d.cacheBytes], { type: d.cacheType || 'image/webp' }))
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
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      preference: 'webgl',
    })

    this.resizeObserver = new ResizeObserver((entries) => {
      const { width: newW, height: newH } = entries[0].contentRect
      const oldW = this.app.screen.width
      const oldH = this.app.screen.height
      this.app.renderer.resize(newW, newH)
      this.camera.handleResize(oldW, oldH, newW, newH)
    })
    this.resizeObserver.observe(container)

    this.camera = new WorldCamera(this.app, { cellSize: ROOM_WORLD_SIZE, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM }, {
      onHoverCell: (cx, cy, sx, sy) => this.handleHoverCell(cx, cy, sx, sy),
      onHoverEnd: () => {
        this.setHoveredFullDetailRoom(null)
        this.callbacks.onRoomHover(null)
      },
      onClickCell: (cx, cy, sx, sy, ctrlKey) => this.handleClickCell(cx, cy, sx, sy, ctrlKey),
      onVisibleBoundsChanged: (bounds) => this.handleVisibleBoundsChanged(bounds),
      onZoomChanged: (zoom) => this.handleZoomChanged(zoom),
    })

    this.boundsGraphics = new Graphics()
    this.camera.world.addChild(this.boundsGraphics)
  }

  get zoom(): number {
    return this.camera?.zoom ?? 1
  }

  setZoom(next: number): void {
    this.camera?.setZoom(next)
  }

  centerOn(rx: number, ry: number, animated = false): void {
    this.camera?.centerOnCell(rx, ry, animated)
  }

  setCurrentUser(userId: string | null): void {
    this.currentUserId = userId
  }

  setBounds(minX: number, maxX: number, minY: number, maxY: number): void {
    this.worldBoundsSet = { minX, maxX, minY, maxY }
    this.camera?.setBounds(minX, maxX, minY, maxY)
    if (!this.boundsGraphics) return
    this.boundsGraphics.clear()
    const x = minX * ROOM_WORLD_SIZE
    const y = minY * ROOM_WORLD_SIZE
    const w = (maxX - minX + 1) * ROOM_WORLD_SIZE
    const h = (maxY - minY + 1) * ROOM_WORLD_SIZE
    this.boundsGraphics.rect(x, y, w, h)
    this.boundsGraphics.stroke({ color: TERRAIN_BORDER, width: 6, alignment: 0 })
  }

  clearBounds(): void {
    this.worldBoundsSet = null
    this.camera?.clearBounds()
    this.boundsGraphics?.clear()
  }

  hasRoom(roomName: string): boolean {
    return this.terrainBaked.has(roomName)
  }

  markRoomFetched(roomName: string): void {
    this.terrainBaked.add(roomName)
  }

  // ── Terrain (Phase 0) ────────────────────────────────────────────────────

  private getLOD(): number {
    return this.zoom < LOD_ZOOM_THRESHOLD ? 0 : 1
  }

  private handleZoomChanged(zoom: number): void {
    const lod = zoom < LOD_ZOOM_THRESHOLD ? 0 : 1
    if (lod !== this.currentLOD) {
      this.currentLOD = lod
      void this.applyLOD()
    }
    this.callbacks.onZoomChanged?.(zoom)
  }

  private async getTerrainBitmap(roomName: string, lod: number, raw: Uint8Array): Promise<ImageBitmap | null> {
    const shard = this.currentShard
    try {
      const cachedBlob = await getTerrainCacheBlob(shard, roomName, lod)
      if (cachedBlob) return await blobToImageBitmap(cachedBlob)

      const id = this.nextBakeId++
      const promise = new Promise<ImageBitmap>((resolve, reject) => {
        this.pendingBakes.set(id, { resolve, reject })
      })
      this.worker.postMessage({ id, roomName, lod, raw, shard })
      return await promise
    } catch {
      return null
    }
  }

  async setRoomTerrain(roomName: string, terrain: { raw: Uint8Array }): Promise<void> {
    const raw = terrain.raw

    let hasContent = false
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== 0) { hasContent = true; break }
    }
    if (!hasContent) {
      this.terrainBaked.add(roomName)
      return
    }

    const entry = this.getOrCreate(roomName)
    const lod = this.getLOD()
    this.terrainData.set(roomName, raw)

    const bitmap = await this.getTerrainBitmap(roomName, lod, raw)
    if (!bitmap) return

    if (!this.activeRooms.has(roomName)) {
      bitmap.close()
      return
    }

    const tex = Texture.from(bitmap)

    if (lod === 0) {
      if (entry.texLo && !entry.texLo.destroyed) {
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

    entry.terrainSprite.width = ROOM_WORLD_SIZE
    entry.terrainSprite.height = ROOM_WORLD_SIZE
    this.terrainBaked.add(roomName)

    void this.ensureCurrentLod(roomName, entry)
    entry.container.visible = true
  }

  private ensureCurrentLod(roomName: string, entry: CellEntry): Promise<void> | void {
    const hi = this.getLOD() === 1
    const have = hi ? entry.texHi : entry.texLo
    if (have && !have.destroyed) {
      entry.terrainSprite.texture = have as unknown as Texture
      return
    }
    const raw = this.terrainData.get(roomName)
    if (!raw) return
    return this.getTerrainBitmap(roomName, hi ? 1 : 0, raw).then((bitmap) => {
      if (!bitmap) return
      if (!this.activeRooms.has(roomName)) { bitmap.close(); return }
      const tex = Texture.from(bitmap)
      if (hi) entry.texHi = tex as unknown as RenderTexture
      else entry.texLo = tex as unknown as RenderTexture
      if ((this.getLOD() === 1) === hi) entry.terrainSprite.texture = tex
    })
  }

  private async applyLOD(): Promise<void> {
    const tasks: Promise<void>[] = []
    for (const [roomName, entry] of this.activeRooms) {
      if (!this.terrainBaked.has(roomName)) continue
      const task = this.ensureCurrentLod(roomName, entry)
      if (task) tasks.push(task)
    }
    await Promise.all(tasks)
  }

  // ── map2 low-detail overlay (Phase 1) ────────────────────────────────────

  setRoomMap2(roomName: string, data: Partial<RoomMap2Data>, source: 'cache' | 'live' = 'live'): void {
    const entry = this.getOrCreate(roomName)
    entry.lastMap2Data = data
    entry.lastMap2Source = source
    this.drawMap2(entry, data, source)
  }

  private drawMap2(entry: CellEntry, data: Partial<RoomMap2Data>, source: 'cache' | 'live'): void {
    const g = entry.map2Graphics
    g.alpha = source === 'cache' ? 0.6 : 1.0
    const MT = MAP2_TILE
    g.clear()

    const roads = data.r ?? []
    for (const [x, y] of roads) {
      g.rect(x * MT, y * MT, MT, MT)
    }
    if (roads.length) g.fill(MINIMAP_ROAD)

    const walls = data.w ?? []
    for (const [x, y] of walls) {
      g.rect(x * MT + 0.5, y * MT + 0.5, MT - 1, MT - 1)
    }
    if (walls.length) g.fill(entry.ownerState === 'other' || entry.ownerState === 'prohibited' ? MINIMAP_WALLS_FOREIGN : MINIMAP_WALLS_OWN)

    for (const feat of MAP2_DOT_FEATURES) {
      const positions = data[feat.key] ?? []
      for (const [x, y] of positions) {
        g.circle((x + 0.5) * MT, (y + 0.5) * MT, feat.radius * MAP2_DOT_SCALE)
      }
      if (positions.length) g.fill(feat.color)
    }

    const dataRec = data as Record<string, [number, number][]>
    for (const key in dataRec) {
      if (MAP2_FIXED_KEYS.has(key)) continue
      const positions = dataRec[key]
      if (!Array.isArray(positions) || positions.length === 0) continue
      for (const [x, y] of positions) {
        g.circle((x + 0.5) * MT, (y + 0.5) * MT, 1.0 * MAP2_DOT_SCALE)
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
    if (entry.ownerState !== state) {
      entry.ownerState = state
      if (entry.lastMap2Data) this.drawMap2(entry, entry.lastMap2Data, entry.lastMap2Source ?? 'live')
    }
  }

  // ── Lifecycle / pooling ──────────────────────────────────────────────────

  // ── Full-detail rooms (Phase 2) ──────────────────────────────────────────
  // The base CellEntry (terrain + map2 dots) is left untouched underneath —
  // a full-detail scene's opaque terrain floor + objects simply occlude it
  // once ready, and removing the scene instantly reveals the (already live)
  // map2 dots again. No visibility toggling or reveal gating needed.

  createFullDetailRoom(roomName: string): boolean {
    if (this.roomScenes.has(roomName)) return false
    const coord = parseRoomName(roomName)
    if (!coord) return false
    const scene = new RoomScene(this.app.ticker, this.app.renderer, this.camera.world)
    scene.root.x = coord.x * ROOM_WORLD_SIZE
    scene.root.y = coord.y * ROOM_WORLD_SIZE
    // Appended after the (already-created) base tile for this room, so it
    // naturally draws on top without needing sortableChildren on `world`.
    this.camera.world.addChild(scene.root)
    this.roomScenes.set(roomName, scene)
    // Resolve a departing creep's exit tile from the room it's actually
    // arriving in, when that neighbor is also rendered in full detail —
    // more precise than the wall-avoidance heuristic ObjectLayer falls back
    // to on its own (see ObjectLayer.setNeighborLookup).
    scene.setNeighborLookup((creepId, dirX, dirY) => {
      const neighborName = formatRoomName(coord.x + dirX, coord.y + dirY)
      return this.roomScenes.get(neighborName)?.getFreshArrival(creepId) ?? null
    })
    return true
  }

  hasFullDetailRoom(roomName: string): boolean {
    return this.roomScenes.has(roomName)
  }

  isFullDetailReady(roomName: string): boolean {
    return this.roomScenes.get(roomName)?.isReady() ?? false
  }

  // True once the room's ObjectLayer exists (its first full snapshot has been
  // applied), independent of whether terrain has also finished baking. Used by
  // the component to decide whether a room:update should feed the selection
  // store as a diff-merge or a full reconcile (see RoomScene.applyUpdate).
  hasFullDetailObjects(roomName: string): boolean {
    return this.roomScenes.get(roomName)?.hasObjectLayer() ?? false
  }

  applyFullDetailTerrain(roomName: string, terrain: RoomTerrain): void {
    this.roomScenes.get(roomName)?.applyTerrain(terrain, this.app.renderer)
  }

  applyFullDetailDecoration(roomName: string, decoration: RoomDecoration): void {
    this.roomScenes.get(roomName)?.applyDecoration(decoration)
  }

  applyFullDetailUpdate(roomName: string, objects: RoomObjectMap, diff: RoomObjectDiff | undefined, opts: RoomSceneUpdateOptions): void {
    this.roomScenes.get(roomName)?.applyUpdate(objects, diff, opts)
  }

  getFullDetailObjectsAtTile(roomName: string, tx: number, ty: number): { id: string; obj: RoomObject }[] {
    return this.roomScenes.get(roomName)?.getObjectsAtTile(tx, ty) ?? []
  }

  getFullDetailVisualById(roomName: string, id: string): Container | undefined {
    return this.roomScenes.get(roomName)?.getVisualById(id)
  }

  setFullDetailSelectedObjects(roomName: string, objects: SelectionVisual[]): void {
    this.roomScenes.get(roomName)?.setSelectedObjects(objects)
  }

  setFullDetailHoveredTile(roomName: string, tx: number | null, ty: number | null): void {
    this.roomScenes.get(roomName)?.setHoveredTile(tx, ty)
  }

  removeFullDetailRoom(roomName: string): void {
    const scene = this.roomScenes.get(roomName)
    if (!scene) return
    if (this.hoveredFullDetailRoom === roomName) this.hoveredFullDetailRoom = null
    scene.dispose()
    this.roomScenes.delete(roomName)
  }

  clearAllFullDetailRooms(): void {
    for (const name of [...this.roomScenes.keys()]) {
      this.removeFullDetailRoom(name)
    }
  }

  clearRoom(roomName: string): void {
    // A room leaving the scroll buffer entirely must not keep rendering full detail.
    this.removeFullDetailRoom(roomName)
    const entry = this.activeRooms.get(roomName)
    if (!entry) return
    if (entry.texLo && !entry.texLo.destroyed) entry.texLo.destroy(true)
    if (entry.texHi && !entry.texHi.destroyed) entry.texHi.destroy(true)
    entry.texLo = null
    entry.texHi = null
    entry.terrainSprite.texture = Texture.EMPTY
    entry.map2Graphics.clear()
    entry.ownerState = 'none'
    entry.lastMap2Data = undefined
    entry.container.visible = false

    this.terrainBaked.delete(roomName)
    this.terrainData.delete(roomName)
    this.activeRooms.delete(roomName)

    if (this.roomPool.length < POOL_SIZE) {
      this.roomPool.push(entry)
    } else {
      this.camera.world.removeChild(entry.container)
      entry.container.destroy({ children: true, context: true })
    }
  }

  // Force every active room to tear down and re-fetch — used on shard change,
  // since terrainBaked/activeRooms are keyed by room name alone and room names
  // collide across shards (mirrors MapRenderer.clearAllRooms).
  clearAllRooms(): void {
    for (const name of [...this.activeRooms.keys()]) {
      this.clearRoom(name)
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
    this.clearAllFullDetailRooms()
    this.camera?.destroy()
    for (const [, entry] of this.activeRooms) {
      if (entry.texLo && !entry.texLo.destroyed) entry.texLo.destroy(true)
      if (entry.texHi && !entry.texHi.destroyed) entry.texHi.destroy(true)
    }
    this.activeRooms.clear()
    for (const entry of this.roomPool) {
      if (entry.texLo && !entry.texLo.destroyed) entry.texLo.destroy(true)
      if (entry.texHi && !entry.texHi.destroyed) entry.texHi.destroy(true)
    }
    this.roomPool.length = 0
    this.terrainBaked.clear()
    this.terrainData.clear()
    this.worker.terminate()
    this.pendingBakes.clear()
    try {
      // NOT texture:true — see MapRenderer.destroy for why (would corrupt the
      // globally shared Texture.EMPTY that every unbaked terrainSprite references).
      this.app.destroy(false, { children: true, context: true })
    } catch {
      /* ignored */
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private getOrCreate(roomName: string): CellEntry {
    const existing = this.activeRooms.get(roomName)
    if (existing) return existing

    const coord = parseRoomName(roomName)
    if (!coord) throw new Error(`MultiRoomRenderer: invalid room "${roomName}"`)

    let entry: CellEntry
    if (this.roomPool.length > 0) {
      entry = this.roomPool.pop()!
    } else {
      const container = new Container()
      container.cullable = true

      const terrainSprite = new Sprite(Texture.EMPTY)
      const map2Graphics  = new Graphics()
      container.addChild(terrainSprite)
      container.addChild(map2Graphics)

      this.camera.world.addChild(container)

      entry = { container, terrainSprite, texLo: null, texHi: null, map2Graphics, ownerState: 'none' }
    }

    entry.container.x = coord.x * ROOM_WORLD_SIZE
    entry.container.y = coord.y * ROOM_WORLD_SIZE
    entry.container.visible = false

    this.activeRooms.set(roomName, entry)
    return entry
  }

  private handleVisibleBoundsChanged(bounds: VisibleBounds): void {
    this.lastVisibleBounds = bounds
    const { rxMin, rxMax, ryMin, ryMax, strictRxMin, strictRxMax, strictRyMin, strictRyMax } = bounds
    const visible: string[] = []
    const inView = new Set<string>()
    const b = this.worldBoundsSet
    const rxFrom = b ? Math.max(rxMin, b.minX) : rxMin
    const rxTo   = b ? Math.min(rxMax, b.maxX) : rxMax
    const ryFrom = b ? Math.max(ryMin, b.minY) : ryMin
    const ryTo   = b ? Math.min(ryMax, b.maxY) : ryMax
    for (let rx = rxFrom; rx <= rxTo; rx++) {
      for (let ry = ryFrom; ry <= ryTo; ry++) {
        const name = formatRoomName(rx, ry)
        if (!name) continue
        visible.push(name)
        if (rx >= strictRxMin && rx <= strictRxMax && ry >= strictRyMin && ry <= strictRyMax) inView.add(name)
      }
    }
    this.callbacks.onVisibleRoomsChanged(visible, inView)
  }

  // Tile-local (0..49) coords within `room` for a screen point already known
  // to fall inside that room's cell — mirrors RoomRenderer.screenToTile but
  // against this camera's world transform instead of a single-room one.
  private screenToLocalTile(room: string, sx: number, sy: number): { tx: number; ty: number } | null {
    const coord = parseRoomName(room)
    if (!coord) return null
    const { wx, wy } = this.camera.screenToWorld(sx, sy)
    const localX = wx - coord.x * ROOM_WORLD_SIZE
    const localY = wy - coord.y * ROOM_WORLD_SIZE
    const tx = Math.floor(localX / TILE_SIZE)
    const ty = Math.floor(localY / TILE_SIZE)
    if (tx < 0 || tx > 49 || ty < 0 || ty > 49) return null
    return { tx, ty }
  }

  private setHoveredFullDetailRoom(room: string | null): void {
    if (this.hoveredFullDetailRoom === room) return
    if (this.hoveredFullDetailRoom) {
      this.roomScenes.get(this.hoveredFullDetailRoom)?.setHoveredTile(null, null)
    }
    this.hoveredFullDetailRoom = room
  }

  private handleHoverCell(cx: number, cy: number, sx: number, sy: number): void {
    const room = formatRoomName(cx, cy)
    this.callbacks.onRoomHover(room)

    if (!room || !this.isFullDetailReady(room)) {
      this.setHoveredFullDetailRoom(null)
      return
    }
    const tile = this.screenToLocalTile(room, sx, sy)
    if (!tile) {
      this.setHoveredFullDetailRoom(null)
      return
    }
    this.setHoveredFullDetailRoom(room)
    this.roomScenes.get(room)?.setHoveredTile(tile.tx, tile.ty)
  }

  private handleClickCell(cx: number, cy: number, sx: number, sy: number, ctrlKey: boolean): void {
    const room = formatRoomName(cx, cy)
    if (!room) return

    // Only ready full-detail rooms support tile-level object clicks; everything
    // else (map2 rooms, or a scene still loading its first snapshot) falls back
    // to the existing room-select/navigate behavior.
    if (this.isFullDetailReady(room)) {
      const tile = this.screenToLocalTile(room, sx, sy)
      if (tile) {
        this.callbacks.onTileClick(room, tile.tx, tile.ty, ctrlKey)
        return
      }
    }
    this.callbacks.onRoomClick(room)
  }
}
