import { Application, Container, Graphics } from 'pixi.js'
import type { RoomTerrain, RoomMap2Data } from 'screeps-connectivity'
import { parseRoomName, formatRoomName } from '~/utils/roomName.js'
import {
  TERRAIN_PLAIN, TERRAIN_WALL, TERRAIN_SWAMP, TERRAIN_ROAD,
  OBJ_GOLD, OBJ_BLUE, OBJ_CYAN, OBJ_ORANGE,
} from '~/renderer/colors.js'

export const MAP_TILE_SIZE = 3
export const MAP_ROOM_SIZE = MAP_TILE_SIZE * 50  // 150px per room

const MIN_ZOOM = 0.15
const MAX_ZOOM = 5

const COLOR_SOURCE     = OBJ_GOLD    // sources
const COLOR_CONTROLLER = OBJ_BLUE    // controllers
const COLOR_MINERAL    = OBJ_CYAN    // minerals
const COLOR_KEEPER     = OBJ_ORANGE  // source keeper lairs
const COLOR_USER       = 0x4488ff    // player creeps/structures
const MAP2_FIXED_KEYS  = new Set(['w', 'r', 'pb', 'p', 's', 'c', 'm', 'k'])

interface RoomEntry {
  container: Container
  terrainGraphics: Graphics
  map2Graphics: Graphics
  ownerOverlay: Graphics
}

export interface MapRendererCallbacks {
  onRoomHover: (room: string | null, screenX: number, screenY: number) => void
  onRoomClick: (room: string) => void
  onVisibleRoomsChanged: (rooms: string[]) => void
}

export class MapRenderer {
  readonly app: Application
  private world!: Container
  private readonly rooms = new Map<string, RoomEntry>()
  private readonly callbacks: MapRendererCallbacks

  private isDragging = false
  private hasDragged = false
  private dragStartX = 0
  private dragStartY = 0
  private dragWorldX = 0
  private dragWorldY = 0
  private lastVisibleKey = ''

  constructor(callbacks: MapRendererCallbacks) {
    this.app = new Application()
    this.callbacks = callbacks
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    await this.app.init({
      canvas,
      resizeTo: canvas.parentElement ?? canvas,
      background: TERRAIN_WALL,
      antialias: false,
      preference: 'webgl',
    })

    this.world = new Container()
    this.app.stage.addChild(this.world)
    this.app.stage.eventMode = 'static'
    this.app.stage.hitArea = this.app.screen

    this.setupInteraction()
    this.app.ticker.add(() => this.checkVisibleRooms())
  }

  centerOn(rx: number, ry: number): void {
    const cx = rx * MAP_ROOM_SIZE + MAP_ROOM_SIZE / 2
    const cy = ry * MAP_ROOM_SIZE + MAP_ROOM_SIZE / 2
    const scale = this.world.scale.x
    this.world.x = this.app.screen.width  / 2 - cx * scale
    this.world.y = this.app.screen.height / 2 - cy * scale
  }

  setRoomTerrain(roomName: string, terrain: RoomTerrain): void {
    const entry = this.getOrCreate(roomName)
    const g = entry.terrainGraphics
    g.clear()
    const MT = MAP_TILE_SIZE

    // Fill entire room background as plain
    g.rect(0, 0, MAP_ROOM_SIZE, MAP_ROOM_SIZE)
    g.fill(TERRAIN_PLAIN)

    // Batch all wall tiles into one fill call
    let hasWalls = false
    for (let i = 0; i < 2500; i++) {
      if (terrain.raw[i] === 1) {
        g.rect((i % 50) * MT, Math.floor(i / 50) * MT, MT, MT)
        hasWalls = true
      }
    }
    if (hasWalls) g.fill(TERRAIN_WALL)

    // Batch all swamp tiles
    let hasSwamp = false
    for (let i = 0; i < 2500; i++) {
      if (terrain.raw[i] === 2) {
        g.rect((i % 50) * MT, Math.floor(i / 50) * MT, MT, MT)
        hasSwamp = true
      }
    }
    if (hasSwamp) g.fill(TERRAIN_SWAMP)
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

  setRoomOwned(roomName: string, owned: boolean): void {
    const entry = this.getOrCreate(roomName)
    const g = entry.ownerOverlay
    g.clear()
    if (owned) {
      g.rect(0, 0, MAP_ROOM_SIZE, MAP_ROOM_SIZE)
      g.fill({ color: 0xff0000, alpha: 0.35 })
    }
  }

  clearRoom(roomName: string): void {
    const entry = this.rooms.get(roomName)
    if (!entry) return
    this.world.removeChild(entry.container)
    entry.container.destroy({ children: true })
    this.rooms.delete(roomName)
  }

  destroy(): void {
    this.rooms.clear()
    this.app.destroy(false, { children: true, texture: true })
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

    const terrainGraphics = new Graphics()
    const map2Graphics    = new Graphics()
    const ownerOverlay    = new Graphics()
    container.addChild(terrainGraphics)
    container.addChild(map2Graphics)
    container.addChild(ownerOverlay)

    this.world.addChild(container)

    const entry: RoomEntry = { container, terrainGraphics, map2Graphics, ownerOverlay }
    this.rooms.set(roomName, entry)
    return entry
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
      this.callbacks.onRoomHover(null, 0, 0)
    })

    this.app.canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      const scale  = this.world.scale.x
      const factor = e.deltaY < 0 ? 1.1 : 0.9
      const next   = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale * factor))
      const wx     = (e.offsetX - this.world.x) / scale
      const wy     = (e.offsetY - this.world.y) / scale
      this.world.scale.set(next)
      this.world.x = e.offsetX - wx * next
      this.world.y = e.offsetY - wy * next
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
    this.callbacks.onRoomHover(this.screenToRoom(sx, sy), sx, sy)
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
      this.callbacks.onVisibleRoomsChanged(visible)
    }
  }
}
