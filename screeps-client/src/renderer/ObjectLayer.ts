import { Container, Graphics, Text, Ticker } from 'pixi.js'
import type { RoomObject, RoomObjectMap, RoomObjectDiff } from 'screeps-connectivity'
import { TILE_SIZE } from './RoomRenderer.js'

const OBJECT_COLORS: Record<string, number> = {
  creep: 0xf0883e,
  spawn: 0x58a6ff,
  extension: 0x79c0ff,
  tower: 0x3fb950,
  container: 0x8b949e,
  storage: 0xd29922,
  link: 0xa371f7,
  rampart: 0x58a6ff,
  road: 0x484f58,
  wall: 0x21262d,
  extractor: 0x8b949e,
  lab: 0xf778ba,
  terminal: 0xd29922,
  observer: 0x79c0ff,
  powerSpawn: 0xf0883e,
  nuker: 0xf85149,
  factory: 0x8b949e,
  invaderCore: 0xf85149,
  source: 0xd29922,
  mineral: 0x79c0ff,
  deposit: 0xd29922,
  controller: 0x58a6ff,
  powerBank: 0xf0883e,
  portal: 0xa371f7,
}

function getObjectColor(type: string): number {
  return OBJECT_COLORS[type] ?? 0xc9d1d9
}

function createObjectVisual(obj: RoomObject): Container {
  const container = new Container()
  const g = new Graphics()
  const color = getObjectColor(obj.type)
  const cx = TILE_SIZE / 2
  const cy = TILE_SIZE / 2

  switch (obj.type) {
    case 'creep': {
      g.circle(cx, cy, TILE_SIZE * 0.35)
      g.fill(color)
      break
    }
    case 'source':
    case 'mineral':
    case 'deposit': {
      g.rect(2, 2, TILE_SIZE - 4, TILE_SIZE - 4)
      g.fill(color)
      break
    }
    case 'controller': {
      g.circle(cx, cy, TILE_SIZE * 0.4)
      g.fill(color)
      g.circle(cx, cy, TILE_SIZE * 0.25)
      g.stroke({ width: 1, color: 0xffffff })
      break
    }
    case 'energy': {
      g.circle(cx, cy, TILE_SIZE * 0.2)
      g.fill(0xd29922)
      break
    }
    case 'road': {
      // Intentionally left empty: rendering is batched in ObjectLayer's roadGraphics
      // but we still need the empty container for selection tracking
      break
    }
    default: {
      // Structures
      const size = TILE_SIZE - 2
      g.rect(1, 1, size, size)
      g.fill(color)
    }
  }

  container.addChild(g)

  // Label for creeps
  if (obj.type === 'creep' && typeof obj.name === 'string') {
    const label = new Text({
      text: obj.name as string,
      style: {
        fontSize: 8,
        fill: 0xffffff,
      },
    })
    label.anchor.set(0.5, 1)
    label.x = cx
    label.y = -2
    container.addChild(label)
  }

  container.position.set(obj.x * TILE_SIZE, obj.y * TILE_SIZE)
  return container
}

type ContainerWithTarget = Container & {
  __targetX?: number
  __targetY?: number
}

export interface ObjectEntry {
  id: string
  obj: RoomObject
  visual: ContainerWithTarget
}

export class ObjectLayer {
  readonly container: Container
  private objects = new Map<string, ContainerWithTarget>()
  private rawObjects = new Map<string, RoomObject>()
  private roadGraphics: Graphics
  private ticker: Ticker | null = null
  private tickerCallback: (() => void) | null = null

  constructor(ticker?: Ticker) {
    this.container = new Container()
    this.roadGraphics = new Graphics()
    this.container.addChild(this.roadGraphics)
    if (ticker) {
      this.ticker = ticker
      this.tickerCallback = () => {
        for (const visual of this.objects.values()) {
          const targetX = visual.__targetX
          const targetY = visual.__targetY
          if (targetX !== undefined && targetY !== undefined) {
            const dx = targetX - visual.x
            const dy = targetY - visual.y
            if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
              visual.position.set(targetX, targetY)
              visual.__targetX = undefined
              visual.__targetY = undefined
            } else {
              visual.x += dx * 0.15
              visual.y += dy * 0.15
            }
          }
        }
      }
      ticker.add(this.tickerCallback)
    }
  }

  update(objects: RoomObjectMap, diff?: RoomObjectDiff): void {
    let roadsChanged = false

    if (diff) {
      for (const [id, changes] of Object.entries(diff)) {
        if (changes === null) {
          const oldObj = this.rawObjects.get(id)
          if (oldObj && oldObj.type === 'road') roadsChanged = true

          const visual = this.objects.get(id)
          if (visual) {
            this.container.removeChild(visual)
            visual.destroy()
            this.objects.delete(id)
            this.rawObjects.delete(id)
          }
        } else {
          const obj = objects[id]
          if (!obj) continue
          
          if (obj.type === 'road') {
            const existing = this.rawObjects.get(id)
            if (!existing || existing.x !== obj.x || existing.y !== obj.y) {
              roadsChanged = true
            }
          }

          this.rawObjects.set(id, obj)
          const existing = this.objects.get(id)
          if (!existing) {
            const visual: ContainerWithTarget = createObjectVisual(obj)
            this.objects.set(id, visual)
            this.container.addChild(visual)
          } else {
            const tx = obj.x * TILE_SIZE
            const ty = obj.y * TILE_SIZE
            if (obj.type === 'creep') {
              if (existing.x !== tx || existing.y !== ty) {
                existing.__targetX = tx
                existing.__targetY = ty
              }
            } else {
              existing.position.set(tx, ty)
            }
          }
        }
      }
    } else {
      const seen = new Set<string>()

      for (const [id, obj] of Object.entries(objects)) {
        seen.add(id)
        this.rawObjects.set(id, obj)
        const existing = this.objects.get(id)
        if (!existing) {
          const visual: ContainerWithTarget = createObjectVisual(obj)
          this.objects.set(id, visual)
          this.container.addChild(visual)
        } else {
          const tx = obj.x * TILE_SIZE
          const ty = obj.y * TILE_SIZE
          if (obj.type === 'creep') {
            if (existing.x !== tx || existing.y !== ty) {
              existing.__targetX = tx
              existing.__targetY = ty
            }
          } else {
            existing.position.set(tx, ty)
          }
        }
      }

      // Remove objects that no longer exist
      for (const [id, visual] of this.objects) {
        if (!seen.has(id)) {
          this.container.removeChild(visual)
          visual.destroy()
          this.objects.delete(id)
          this.rawObjects.delete(id)
        }
      }

      roadsChanged = true
    }

    if (roadsChanged) {
      this.redrawRoads()
    }
  }

  private redrawRoads(): void {
    this.roadGraphics.clear()
    const color = OBJECT_COLORS['road'] ?? 0x484f58

    const roadGrid = Array.from({ length: 50 }, () => new Array(50).fill(false))
    const roads: RoomObject[] = []

    for (const obj of this.rawObjects.values()) {
      if (obj.type === 'road') {
        roads.push(obj)
        if (obj.x >= 0 && obj.x < 50 && obj.y >= 0 && obj.y < 50) {
          roadGrid[obj.x][obj.y] = true
        }
      }
    }

    if (roads.length === 0) return

    const cxOffset = TILE_SIZE / 2
    const cyOffset = TILE_SIZE / 2
    const radius = TILE_SIZE * 0.15

    // Draw center dots
    for (const r of roads) {
      this.roadGraphics.circle(r.x * TILE_SIZE + cxOffset, r.y * TILE_SIZE + cyOffset, radius)
    }
    this.roadGraphics.fill(color)

    // Draw connections
    const neighbors = [
      [1, 0],   // right
      [1, 1],   // bottom-right
      [0, 1],   // bottom
      [-1, 1],  // bottom-left
    ]

    for (const r of roads) {
      const cx = r.x * TILE_SIZE + cxOffset
      const cy = r.y * TILE_SIZE + cyOffset

      for (const [dx, dy] of neighbors) {
        const nx = r.x + dx
        const ny = r.y + dy
        if (nx >= 0 && nx < 50 && ny >= 0 && ny < 50 && roadGrid[nx][ny]) {
          const ncx = nx * TILE_SIZE + cxOffset
          const ncy = ny * TILE_SIZE + cyOffset
          this.roadGraphics.moveTo(cx, cy)
          this.roadGraphics.lineTo(ncx, ncy)
        }
      }
    }
    this.roadGraphics.stroke({ width: radius * 2, color })
  }

  /**
   * Return all objects whose tile position matches (tx, ty).
   * For creeps the tile is derived from their *target* (data) position, not
   * the interpolated visual position, so selection is consistent.
   */
  getObjectsAtTile(tx: number, ty: number): ObjectEntry[] {
    const result: ObjectEntry[] = []
    for (const [id, visual] of this.objects) {
      const obj = this.rawObjects.get(id)
      if (!obj) continue
      if (obj.x === tx && obj.y === ty) {
        result.push({ id, obj, visual })
      }
    }
    return result
  }

  /** Return the live PixiJS container for an object by id, if present. */
  getVisualById(id: string): ContainerWithTarget | undefined {
    return this.objects.get(id)
  }

  clear(): void {
    for (const visual of this.objects.values()) {
      visual.destroy()
    }
    this.objects.clear()
    this.rawObjects.clear()
    this.container.removeChildren()
  }

  destroy(): void {
    this.clear()
    if (this.ticker && this.tickerCallback) {
      this.ticker.remove(this.tickerCallback)
    }
    this.ticker = null
    this.tickerCallback = null
  }
}
