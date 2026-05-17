import { Container, Graphics, Text, Ticker, Sprite } from 'pixi.js'
import type { RoomObject, RoomObjectMap, RoomObjectDiff, Badge } from 'screeps-connectivity'
import { BadgeTextureCache } from './BadgeTextureCache.js'
import { TILE_SIZE } from './RoomRenderer.js'
import {
  BODY_PART_COLORS,
  OBJECT_COLORS,
  BG_DEEP, BG_DARK,
  OBJ_DEFAULT, OBJ_CYAN, OBJ_ROAD, OBJ_GOLD, OBJ_WALL,
  ENERGY_FILL,
  CREEP_RING_DARK, CREEP_NOTCH,
} from './colors.js'

const CREEP_OUTER_R = TILE_SIZE * 0.44
const CREEP_INNER_R = TILE_SIZE * 0.28
const CREEP_MAX_BODY = 50

function drawCreepArc(g: Graphics, startAngle: number, endAngle: number, color: number): void {
  if (endAngle - startAngle < 0.001) return
  g.moveTo(CREEP_OUTER_R * Math.cos(startAngle), CREEP_OUTER_R * Math.sin(startAngle))
  g.arc(0, 0, CREEP_OUTER_R, startAngle, endAngle)
  g.lineTo(CREEP_INNER_R * Math.cos(endAngle), CREEP_INNER_R * Math.sin(endAngle))
  g.arc(0, 0, CREEP_INNER_R, endAngle, startAngle, true)
  g.closePath()
  g.fill(color)
}

function getCreepStore(obj: RoomObject): { used: number; capacity: number } {
  let capacity = 0
  if (typeof obj.storeCapacity === 'number') {
    capacity = obj.storeCapacity
  } else {
    const body = obj.body as Array<{ type: string }> | undefined
    if (body) capacity = body.filter(p => p.type === 'carry').length * 50
  }
  if (capacity === 0) return { used: 0, capacity: 0 }

  let used = 0
  if (obj.store && typeof obj.store === 'object') {
    for (const v of Object.values(obj.store as Record<string, unknown>)) {
      if (typeof v === 'number') used += v
    }
  } else if (typeof obj.energy === 'number') {
    used = obj.energy
  }
  return { used, capacity }
}

function calcCreepFillRadius(used: number, capacity: number): number {
  if (capacity <= 0 || used <= 0) return 0
  return CREEP_INNER_R * 0.8 * Math.min(1, used / capacity)
}

function updateCreepFill(visual: Container, radius: number): void {
  const fill = (visual as Container & { __creepFillGraphics?: Graphics }).__creepFillGraphics
  if (!fill) return
  fill.clear()
  if (radius > 0) {
    fill.circle(0, 0, radius)
    fill.fill(ENERGY_FILL)
  }
}

function getObjectColor(type: string): number {
  return OBJECT_COLORS[type] ?? OBJ_DEFAULT
}

function getExtensionEnergy(obj: RoomObject): { energy: number; capacity: number } {
  const capacity = typeof obj.energyCapacity === 'number'
    ? obj.energyCapacity
    : typeof obj.storeCapacity === 'number'
      ? obj.storeCapacity
      : 50

  let energy = 0
  if (typeof obj.energy === 'number') {
    energy = obj.energy
  } else if (obj.store && typeof obj.store === 'object') {
    const store = obj.store as Record<string, number>
    energy = store.energy ?? 0
  }

  return { energy, capacity }
}

function getExtensionOuterRadius(capacity: number): number {
  return capacity < 100 ? TILE_SIZE * 0.32 : TILE_SIZE * 0.42
}

function calcExtensionFillRadius(energy: number, capacity: number): number {
  const outerRadius = getExtensionOuterRadius(capacity)
  if (capacity <= 0 || energy <= 0) return 0
  const ratio = Math.min(1, energy / capacity)
  return outerRadius * 0.25 + (outerRadius * 0.7) * ratio
}

function drawExtensionVisual(container: Container, energy: number, capacity: number): void {
  const cx = TILE_SIZE / 2
  const cy = TILE_SIZE / 2
  const outerRadius = getExtensionOuterRadius(capacity)
  const borderColor = OBJ_CYAN
  const bgColor = BG_DARK
  const fillColor = ENERGY_FILL

  // Remove old graphics children
  for (const child of container.children) {
    if (child instanceof Graphics) {
      child.destroy()
    }
  }

  const bg = new Graphics()
  bg.circle(cx, cy, outerRadius)
  bg.fill(bgColor)
  bg.circle(cx, cy, outerRadius)
  bg.stroke({ width: 1, color: borderColor })
  container.addChild(bg)

  const radius = calcExtensionFillRadius(energy, capacity)
  const fill = new Graphics()
  if (radius > 0) {
    fill.circle(cx, cy, radius)
    fill.fill(fillColor)
  }
  container.addChild(fill)

  ;(container as Container & { __fillGraphics?: Graphics }).__fillGraphics = fill
}

function updateExtensionFill(visual: Container, radius: number): void {
  const cx = TILE_SIZE / 2
  const cy = TILE_SIZE / 2
  const fillColor = ENERGY_FILL
  const fill = (visual as Container & { __fillGraphics?: Graphics }).__fillGraphics

  if (!fill) return
  fill.clear()
  if (radius > 0) {
    fill.circle(cx, cy, radius)
    fill.fill(fillColor)
  }
}

function isForeignCreep(obj: RoomObject, currentUserId?: string): boolean {
  const creepUser = obj.user
  if (typeof creepUser !== 'string') return false
  if (!currentUserId) return false
  return creepUser !== currentUserId
}

function createObjectVisual(
  obj: RoomObject,
  showLabel = true,
  currentUserId?: string,
  badge?: Badge,
  badgeCache?: BadgeTextureCache,
): Container {
  const container = new Container()
  const g = new Graphics()
  const color = getObjectColor(obj.type)
  const cx = TILE_SIZE / 2
  const cy = TILE_SIZE / 2

  switch (obj.type) {
    case 'creep': {
      const FULL = 2 * Math.PI

      const bodyContainer = new Container()
      bodyContainer.position.set(cx, cy)
      bodyContainer.rotation = -Math.PI / 2

      if (isForeignCreep(obj, currentUserId)) {
        const borderG = new Graphics()
        borderG.circle(0, 0, CREEP_OUTER_R + 1.5)
        borderG.stroke({ width: 3, color: 0xff0000 })
        bodyContainer.addChild(borderG)
      }

      const bgG = new Graphics()
      bgG.circle(0, 0, CREEP_OUTER_R)
      bgG.fill(BG_DEEP)
      bodyContainer.addChild(bgG)

      // Count body parts by zone
      const bodyParts = (obj.body as Array<{ type: string }> | undefined) ?? []
      let workCount = 0
      let moveCount = 0
      const otherOrder: string[] = []
      const otherCounts: Record<string, number> = {}
      for (const part of bodyParts) {
        if (part.type === 'work') {
          workCount++
        } else if (part.type === 'move') {
          moveCount++
        } else {
          if (otherCounts[part.type] === undefined) {
            otherOrder.push(part.type)
            otherCounts[part.type] = 0
          }
          otherCounts[part.type]!++
        }
      }
      const otherTotal = otherOrder.reduce((s, t) => s + (otherCounts[t] ?? 0), 0)

      // Proportional angle allocations (relative to MAX_BODY=50)
      const workAngle  = (workCount  / CREEP_MAX_BODY) * FULL
      const moveAngle  = (moveCount  / CREEP_MAX_BODY) * FULL
      const otherAngle = (otherTotal / CREEP_MAX_BODY) * FULL

      // Zone boundaries (local space: 0 = top after -π/2 rotation, clockwise)
      // WORK: centered at local 0 (top)
      // MOVE: centered at local π (bottom)
      // OTHER: split left/right, adjacent to WORK, filling toward MOVE
      // DARK: remaining space between OTHER and MOVE
      const workEnd        = workAngle / 2
      const rightOtherEnd  = workEnd + otherAngle / 2
      const moveStart      = Math.PI - moveAngle / 2
      const moveEnd        = Math.PI + moveAngle / 2
      const leftOtherStart = FULL - workAngle / 2 - otherAngle / 2
      const leftOtherEnd   = FULL - workAngle / 2

      const arcsG = new Graphics()

      // 1. WORK — top, centered
      if (workAngle > 0) {
        drawCreepArc(arcsG, -workAngle / 2, workEnd, BODY_PART_COLORS['work'] ?? 0xffe56d)
      }

      // 2. RIGHT OTHER — clockwise from WORK, filling toward MOVE
      let rightCur = workEnd
      for (const type of otherOrder) {
        const angle = ((otherCounts[type] ?? 0) / CREEP_MAX_BODY) * FULL / 2
        drawCreepArc(arcsG, rightCur, rightCur + angle, BODY_PART_COLORS[type] ?? 0x777777)
        rightCur += angle
      }

      // 3. RIGHT DARK
      drawCreepArc(arcsG, rightOtherEnd, moveStart, CREEP_RING_DARK)

      // 4. MOVE — bottom, centered
      if (moveAngle > 0) {
        drawCreepArc(arcsG, moveStart, moveEnd, BODY_PART_COLORS['move'] ?? 0xa9b7c6)
      }

      // 5. LEFT DARK
      drawCreepArc(arcsG, moveEnd, leftOtherStart, CREEP_RING_DARK)

      // 6. LEFT OTHER — filling from WORK downward (counter-clockwise = reverse order, drawn as clockwise arcs)
      let leftCur = leftOtherEnd
      for (const type of otherOrder) {
        const angle = ((otherCounts[type] ?? 0) / CREEP_MAX_BODY) * FULL / 2
        drawCreepArc(arcsG, leftCur - angle, leftCur, BODY_PART_COLORS[type] ?? 0x777777)
        leftCur -= angle
      }

      bodyContainer.addChild(arcsG)

      // Inner dark circle
      const innerG = new Graphics()
      innerG.circle(0, 0, CREEP_INNER_R)
      innerG.fill(BG_DARK)
      bodyContainer.addChild(innerG)

      // Own-player badge (under the energy fill)
      const isOwn = !isForeignCreep(obj, currentUserId)
      if (isOwn && badge && badgeCache) {
        const badgeSprite = new Sprite()
        badgeSprite.anchor.set(0.5, 0.5)
        const size = CREEP_INNER_R * 2
        badgeSprite.width = size
        badgeSprite.height = size
        badgeSprite.rotation = Math.PI / 2
        bodyContainer.addChild(badgeSprite)
        badgeCache.getOrCreate(badge).then((texture) => {
          if (!badgeSprite.destroyed) {
            badgeSprite.texture = texture
          }
        }).catch(() => {})
      }

      // Store fill (animated, updated on store changes)
      const { used, capacity } = getCreepStore(obj)
      const fillRadius = calcCreepFillRadius(used, capacity)
      const fillG = new Graphics()
      if (fillRadius > 0) {
        fillG.circle(0, 0, fillRadius)
        fillG.fill(ENERGY_FILL)
      }
      bodyContainer.addChild(fillG)
      ;(container as ContainerWithTarget).__creepFillGraphics = fillG
      ;(container as ContainerWithTarget).__creepUsed = used
      ;(container as ContainerWithTarget).__creepCapacity = capacity

      // Direction indicator (notch pointing right = local angle 0)
      const midR   = (CREEP_OUTER_R + CREEP_INNER_R) / 2
      const halfH  = (CREEP_OUTER_R - CREEP_INNER_R) * 0.45
      const notchG = new Graphics()
      notchG.moveTo(CREEP_OUTER_R, 0)
      notchG.lineTo(midR, -halfH)
      notchG.lineTo(midR,  halfH)
      notchG.closePath()
      notchG.fill(CREEP_NOTCH)
      bodyContainer.addChild(notchG)

      container.addChild(bodyContainer)
      ;(container as ContainerWithTarget).__bodyContainer = bodyContainer
      break
    }
    case 'extension': {
      const { energy, capacity } = getExtensionEnergy(obj)
      drawExtensionVisual(container, energy, capacity)
      ;(container as Container & { __extEnergy?: number; __extCapacity?: number }).__extEnergy = energy
      ;(container as Container & { __extEnergy?: number; __extCapacity?: number }).__extCapacity = capacity
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
      g.stroke({ width: 1, color: OBJ_DEFAULT })
      break
    }
    case 'energy': {
      g.circle(cx, cy, TILE_SIZE * 0.2)
      g.fill(OBJ_GOLD)
      break
    }
    case 'road': {
      // Intentionally left empty: rendering is batched in ObjectLayer's roadGraphics
      // but we still need the empty container for selection tracking
      break
    }
    case 'spawn': {
      g.circle(cx, cy, TILE_SIZE * 0.45)
      g.fill(OBJ_WALL)
      g.circle(cx, cy, TILE_SIZE * 0.3)
      g.fill(color)
      g.circle(cx, cy, TILE_SIZE * 0.15)
      g.fill(ENERGY_FILL)
      break
    }
    case 'tower': {
      // Base
      g.rect(2, 2, TILE_SIZE - 4, TILE_SIZE - 4)
      g.fill(OBJ_WALL)
      // Turret base
      g.circle(cx, cy, TILE_SIZE * 0.35)
      g.fill(color)
      // Barrel
      g.rect(cx - TILE_SIZE * 0.1, 1, TILE_SIZE * 0.2, cy - 1)
      g.fill(0xcccccc)
      break
    }
    case 'storage': {
      g.roundRect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2, TILE_SIZE * 0.3)
      g.fill(OBJ_WALL)
      g.roundRect(3, 3, TILE_SIZE - 6, TILE_SIZE - 6, TILE_SIZE * 0.2)
      g.stroke({ width: 2, color })
      break
    }
    case 'terminal': {
      g.poly([
        cx, 1,
        TILE_SIZE - 1, cx,
        cx, TILE_SIZE - 1,
        1, cx
      ])
      g.fill(OBJ_WALL)
      g.poly([
        cx, 3,
        TILE_SIZE - 3, cx,
        cx, TILE_SIZE - 3,
        3, cx
      ])
      g.stroke({ width: 2, color })
      break
    }
    case 'link': {
      g.poly([
        cx, 1,
        TILE_SIZE - 1, cx,
        cx, TILE_SIZE - 1,
        1, cx
      ])
      g.fill(OBJ_WALL)
      g.poly([
        cx, 4,
        TILE_SIZE - 4, cx,
        cx, TILE_SIZE - 4,
        4, cx
      ])
      g.fill(color)
      break
    }
    case 'lab': {
      g.circle(cx, cy, TILE_SIZE * 0.45)
      g.fill(OBJ_WALL)
      g.circle(cx, cy, TILE_SIZE * 0.35)
      g.fill(0x222222)
      g.circle(cx, cy, TILE_SIZE * 0.25)
      g.fill(color)
      break
    }
    case 'container': {
      g.rect(2, 2, TILE_SIZE - 4, TILE_SIZE - 4)
      g.fill(OBJ_WALL)
      g.rect(4, 4, TILE_SIZE - 8, TILE_SIZE - 8)
      g.fill(color)
      break
    }
    case 'wall': {
      g.rect(0, 0, TILE_SIZE, TILE_SIZE)
      g.fill(BG_DEEP)
      g.rect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2)
      g.fill(OBJ_WALL)
      break
    }
    case 'rampart': {
      g.rect(0, 0, TILE_SIZE, TILE_SIZE)
      g.fill({ color: color, alpha: 0.3 })
      g.rect(0, 0, TILE_SIZE, TILE_SIZE)
      g.stroke({ width: 2, color: color, alpha: 0.5 })
      break
    }
    case 'nuker':
    case 'observer':
    case 'powerSpawn':
    case 'factory':
    case 'extractor':
    case 'invaderCore': {
      g.circle(cx, cy, TILE_SIZE * 0.45)
      g.fill(OBJ_WALL)
      g.circle(cx, cy, TILE_SIZE * 0.35)
      g.stroke({ width: 2, color })
      break
    }
    default: {
      // Structures (fallback)
      const size = TILE_SIZE - 2
      g.rect(1, 1, size, size)
      g.fill(color)
    }
  }

  if (obj.type !== 'extension' && obj.type !== 'road' && obj.type !== 'creep') {
    container.addChild(g)
  }

  // Label for creeps — render at 4× font size, scale down to stay crisp when zoomed
  if (obj.type === 'creep' && typeof obj.name === 'string') {
    const FONT_SIZE = 32
    const FONT_SCALE = 8 / FONT_SIZE
    const label = new Text({
      text: obj.name as string,
      style: { fontSize: FONT_SIZE, fill: 0xffffff },
    })
    label.scale.set(FONT_SCALE)
    label.anchor.set(0.5, 1)
    label.x = cx
    label.y = -2
    label.visible = showLabel
    ;(container as ContainerWithTarget).__nameLabel = label
    container.addChild(label)
  }

  if (obj.type === 'creep') container.zIndex = 1

  container.position.set(obj.x * TILE_SIZE, obj.y * TILE_SIZE)
  return container
}

type ContainerWithTarget = Container & {
  __targetX?: number
  __targetY?: number
  __tileX?: number
  __tileY?: number
  __angle?: number
  __bodyContainer?: Container
  __creepFillGraphics?: Graphics
  __creepUsed?: number
  __creepCapacity?: number
  __nameLabel?: Text
  __creepBorderG?: Graphics
  __creepBadgeSprite?: Sprite
}

interface ExtAnimation {
  visual: ContainerWithTarget
  fromRadius: number
  toRadius: number
  startTime: number
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
  private extAnimations = new Map<string, ExtAnimation>()
  private creepFillAnimations = new Map<string, ExtAnimation>()
  private readonly EXT_ANIM_DURATION = 300
  private showLabels: boolean
  private currentUserId?: string
  private badge?: Badge
  private badgeCache = new BadgeTextureCache()

  constructor(ticker?: Ticker, showLabels = true, currentUserId?: string, badge?: Badge) {
    this.showLabels = showLabels
    this.currentUserId = currentUserId
    this.badge = badge
    this.container = new Container()
    this.container.sortableChildren = true
    this.roadGraphics = new Graphics()
    this.container.addChild(this.roadGraphics)
    if (ticker) {
      this.ticker = ticker
      this.tickerCallback = () => this.tick()
      ticker.add(this.tickerCallback)
    }
  }

  private tick(): void {
    // Creep movement interpolation
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

    // Extension + creep fill animations
    const now = performance.now()
    for (const [id, anim] of this.extAnimations) {
      const elapsed = now - anim.startTime
      const t = Math.min(1, elapsed / this.EXT_ANIM_DURATION)
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      updateExtensionFill(anim.visual, anim.fromRadius + (anim.toRadius - anim.fromRadius) * ease)
      if (t >= 1) this.extAnimations.delete(id)
    }
    for (const [id, anim] of this.creepFillAnimations) {
      const elapsed = now - anim.startTime
      const t = Math.min(1, elapsed / this.EXT_ANIM_DURATION)
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      updateCreepFill(anim.visual, anim.fromRadius + (anim.toRadius - anim.fromRadius) * ease)
      if (t >= 1) this.creepFillAnimations.delete(id)
    }
  }

  private startExtAnimation(
    id: string,
    visual: ContainerWithTarget,
    fromEnergy: number,
    fromCapacity: number,
    toEnergy: number,
    toCapacity: number,
  ): void {
    const fromRadius = calcExtensionFillRadius(fromEnergy, fromCapacity)
    const toRadius = calcExtensionFillRadius(toEnergy, toCapacity)
    if (fromRadius === toRadius) return
    this.extAnimations.set(id, { visual, fromRadius, toRadius, startTime: performance.now() })
  }

  private startCreepFillAnimation(
    id: string,
    visual: ContainerWithTarget,
    fromUsed: number,
    fromCapacity: number,
    toUsed: number,
    toCapacity: number,
  ): void {
    const fromRadius = calcCreepFillRadius(fromUsed, fromCapacity)
    const toRadius = calcCreepFillRadius(toUsed, toCapacity)
    if (fromRadius === toRadius) return
    this.creepFillAnimations.set(id, { visual, fromRadius, toRadius, startTime: performance.now() })
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
            this.extAnimations.delete(id)
            this.creepFillAnimations.delete(id)
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
            const visual: ContainerWithTarget = createObjectVisual(obj, this.showLabels, this.currentUserId, this.badge, this.badgeCache)
            visual.__tileX = obj.x
            visual.__tileY = obj.y
            this.objects.set(id, visual)
            this.container.addChild(visual)
          } else {
            const tx = obj.x * TILE_SIZE
            const ty = obj.y * TILE_SIZE
            if (obj.type === 'creep') {
              const dx = obj.x - (existing.__tileX ?? obj.x)
              const dy = obj.y - (existing.__tileY ?? obj.y)
              if (dx !== 0 || dy !== 0) {
                existing.__angle = Math.atan2(dy, dx)
                if (existing.__bodyContainer) existing.__bodyContainer.rotation = existing.__angle
              }
              existing.__tileX = obj.x
              existing.__tileY = obj.y
              if (existing.x !== tx || existing.y !== ty) {
                existing.__targetX = tx
                existing.__targetY = ty
              }
              const { used, capacity } = getCreepStore(obj)
              if (existing.__creepUsed !== used || existing.__creepCapacity !== capacity) {
                this.startCreepFillAnimation(id, existing, existing.__creepUsed ?? 0, existing.__creepCapacity ?? capacity, used, capacity)
                existing.__creepUsed = used
                existing.__creepCapacity = capacity
              }
            } else {
              existing.position.set(tx, ty)
            }

            if (obj.type === 'extension') {
              const { energy, capacity } = getExtensionEnergy(obj)
              const ext = existing as ContainerWithTarget & { __extEnergy?: number; __extCapacity?: number }
              if (ext.__extEnergy !== energy || ext.__extCapacity !== capacity) {
                this.startExtAnimation(
                  id,
                  existing,
                  ext.__extEnergy ?? 0,
                  ext.__extCapacity ?? capacity,
                  energy,
                  capacity,
                )
                ext.__extEnergy = energy
                ext.__extCapacity = capacity
              }
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
          const visual: ContainerWithTarget = createObjectVisual(obj, this.showLabels, this.currentUserId, this.badge, this.badgeCache)
          visual.__tileX = obj.x
          visual.__tileY = obj.y
          this.objects.set(id, visual)
          this.container.addChild(visual)
        } else {
          const tx = obj.x * TILE_SIZE
          const ty = obj.y * TILE_SIZE
          if (obj.type === 'creep') {
            const dx = obj.x - (existing.__tileX ?? obj.x)
            const dy = obj.y - (existing.__tileY ?? obj.y)
            if (dx !== 0 || dy !== 0) {
              existing.__angle = Math.atan2(dy, dx)
              if (existing.__bodyContainer) existing.__bodyContainer.rotation = existing.__angle
            }
            existing.__tileX = obj.x
            existing.__tileY = obj.y
            if (existing.x !== tx || existing.y !== ty) {
              existing.__targetX = tx
              existing.__targetY = ty
            }
            const { used, capacity } = getCreepStore(obj)
            if (existing.__creepUsed !== used || existing.__creepCapacity !== capacity) {
              this.startCreepFillAnimation(id, existing, existing.__creepUsed ?? 0, existing.__creepCapacity ?? capacity, used, capacity)
              existing.__creepUsed = used
              existing.__creepCapacity = capacity
            }
          } else {
            existing.position.set(tx, ty)
          }

          if (obj.type === 'extension') {
            const { energy, capacity } = getExtensionEnergy(obj)
            const ext = existing as ContainerWithTarget & { __extEnergy?: number; __extCapacity?: number }
            if (ext.__extEnergy !== energy || ext.__extCapacity !== capacity) {
              this.startExtAnimation(
                id,
                existing,
                ext.__extEnergy ?? 0,
                ext.__extCapacity ?? capacity,
                energy,
                capacity,
              )
              ext.__extEnergy = energy
              ext.__extCapacity = capacity
            }
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
          this.extAnimations.delete(id)
          this.creepFillAnimations.delete(id)
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
    const color = OBJ_ROAD

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

  setShowLabels(show: boolean): void {
    this.showLabels = show
    for (const visual of this.objects.values()) {
      if (visual.__nameLabel) visual.__nameLabel.visible = show
    }
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
    this.extAnimations.clear()
    this.creepFillAnimations.clear()
    this.container.removeChildren()
  }

  destroy(): void {
    this.clear()
    if (this.ticker && this.tickerCallback) {
      this.ticker.remove(this.tickerCallback)
    }
    this.ticker = null
    this.tickerCallback = null
    this.badgeCache.destroy()
  }
}
