import { Container, Graphics, Text, Ticker, Sprite } from 'pixi.js'
import type { RoomObject, RoomObjectMap, RoomObjectDiff, Badge } from '@bastianh/screeps-connectivity'
import { BadgeTextureCache } from './BadgeTextureCache.js'
import { TILE_SIZE } from './RoomRenderer.js'
import {
  BODY_PART_COLORS,
  OBJECT_COLORS,
  BG_DEEP, BG_DARK,
  OBJ_DEFAULT, OBJ_ROAD, OBJ_GOLD,
  ENERGY_FILL,
  CREEP_RING_DARK, CREEP_NOTCH,
  ST_DARK, ST_GRAY, ST_LIGHT, ST_OUTLINE, ST_ENERGY, ST_POWER, ST_RAMPART,
  FLAG_COLORS,
} from './colors.js'

const CREEP_OUTER_R = TILE_SIZE * 0.44
const CREEP_INNER_R = TILE_SIZE * 0.28
const CREEP_MAX_BODY = 50

const LABEL_FONT_SIZE  = 32
const LABEL_FONT_SCALE = 12 / LABEL_FONT_SIZE  // base scale: ~12px height at world-scale=1
// Label bottom sits GAP_PX screen-pixels above the creep outer edge; constant across zoom levels.
const LABEL_CREEP_TOP = TILE_SIZE / 2 - TILE_SIZE * 0.44  // CREEP_OUTER_R in container space
const LABEL_GAP_PX    = 2

const EXT_OUTER_R = TILE_SIZE * 0.42
const EXT_INNER_R = TILE_SIZE * 0.30
const EXT_STROKE_W = Math.max(1, TILE_SIZE * 0.08)

// Converts screeps tile-relative coords (tile center = origin, 1 unit = TILE_SIZE px) to flat pixel array
function spts(cx: number, cy: number, pts: ReadonlyArray<readonly [number, number]>): number[] {
  return pts.flatMap(([rx, ry]) => [cx + rx * TILE_SIZE, cy + ry * TILE_SIZE])
}

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
    // Avoid Object.values allocation
    const storeObj = obj.store as Record<string, unknown>
    for (const k in storeObj) {
      const v = storeObj[k]
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

function extScale(capacity: number): number {
  return capacity < 100 ? 0.7 : 1.0
}

function calcExtensionFillRadius(energy: number, capacity: number): number {
  if (capacity <= 0 || energy <= 0) return 0
  return EXT_INNER_R * extScale(capacity) * Math.min(1, energy / capacity)
}

function drawExtensionVisual(container: Container, energy: number, capacity: number): void {
  const cx = TILE_SIZE / 2
  const cy = TILE_SIZE / 2
  const scale = extScale(capacity)
  const g = new Graphics()
  g.circle(cx, cy, EXT_OUTER_R * scale)
  g.fill(ST_DARK)
  g.circle(cx, cy, EXT_OUTER_R * scale)
  g.stroke({ width: EXT_STROKE_W * scale, color: ST_OUTLINE })
  g.circle(cx, cy, EXT_INNER_R * scale)
  g.fill(ST_LIGHT)
  container.addChild(g)

  const fill = new Graphics()
  const radius = calcExtensionFillRadius(energy, capacity)
  if (radius > 0) {
    fill.circle(cx, cy, radius)
    fill.fill(ST_ENERGY)
  }
  container.addChild(fill)
  ;(container as Container & { __fillGraphics?: Graphics }).__fillGraphics = fill
}

function updateExtensionFill(visual: Container, radius: number): void {
  const cx = TILE_SIZE / 2
  const cy = TILE_SIZE / 2
  const fill = (visual as Container & { __fillGraphics?: Graphics }).__fillGraphics
  if (!fill) return
  fill.clear()
  if (radius > 0) {
    fill.circle(cx, cy, radius)
    fill.fill(ST_ENERGY)
  }
}

const TOWER_BODY_X = -TILE_SIZE * 0.4
const TOWER_BODY_Y = -TILE_SIZE * 0.3
const TOWER_BODY_W = TILE_SIZE * 0.8
const TOWER_BODY_H = TILE_SIZE * 0.6

function calcTowerFillHeight(energy: number, capacity: number): number {
  if (capacity <= 0 || energy <= 0) return 0
  return TOWER_BODY_H * Math.min(1, energy / capacity)
}

function updateTowerFill(visual: ContainerWithTarget, height: number): void {
  const fill = visual.__towerFillGraphics
  if (!fill) return
  fill.clear()
  if (height > 0) {
    const margin = Math.max(0.5, TILE_SIZE * 0.02)
    fill.rect(TOWER_BODY_X + margin, TOWER_BODY_Y + TOWER_BODY_H - height + margin, TOWER_BODY_W - margin * 2, height - margin * 2)
    fill.fill(ST_ENERGY)
  }
}

// ── Controller helpers ─────────────────────────────────────────────────────

const CTRL_OCTO_R  = TILE_SIZE * 0.65
const CTRL_SEG_OUT = CTRL_OCTO_R
const CTRL_SEG_IN  = TILE_SIZE * 0.42

function drawControllerSegments(
  g: Graphics,
  cx: number, cy: number,
  outerR: number, innerR: number,
  level: number, progress: number, progressTotal: number,
): void {
  g.clear()
  const SEG_COUNT  = 8
  const gapAngle   = 0.10
  const segArc     = (2 * Math.PI / SEG_COUNT) - gapAngle

  for (let i = 0; i < SEG_COUNT; i++) {
    const a0 = -Math.PI / 2 + i * (2 * Math.PI / SEG_COUNT) + gapAngle / 2
    const a1 = a0 + segArc
    const sx = cx + innerR * Math.cos(a0)
    const sy = cy + innerR * Math.sin(a0)

    if (i < level) {
      g.moveTo(sx, sy)
      g.arc(cx, cy, outerR, a0, a1)
      g.arc(cx, cy, innerR, a1, a0, true)
      g.closePath()
      g.fill({ color: 0xdddddd, alpha: 0.9 })
    } else if (i === level && progressTotal > 0) {
      g.moveTo(sx, sy)
      g.arc(cx, cy, outerR, a0, a1)
      g.arc(cx, cy, innerR, a1, a0, true)
      g.closePath()
      g.fill({ color: 0x1e1e1e, alpha: 0.85 })
      if (progress > 0) {
        const ratio = Math.min(1, progress / progressTotal)
        const pe = a0 + segArc * ratio
        g.moveTo(sx, sy)
        g.arc(cx, cy, outerR, a0, pe)
        g.arc(cx, cy, innerR, pe, a0, true)
        g.closePath()
        g.fill({ color: 0xdddddd, alpha: 0.9 })
      }
    } else {
      g.moveTo(sx, sy)
      g.arc(cx, cy, outerR, a0, a1)
      g.arc(cx, cy, innerR, a1, a0, true)
      g.closePath()
      g.fill({ color: 0x1e1e1e, alpha: 0.6 })
    }
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
  _badge?: Badge,
  badgeCache?: BadgeTextureCache,
  users?: Record<string, { _id: string; username: string; badge?: Badge }>,
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

      const isForeign = isForeignCreep(obj, currentUserId)
      if (isForeign) {
        const borderG = new Graphics()
        borderG.circle(0, 0, CREEP_OUTER_R + 0.75)
        borderG.stroke({ width: 1.5, color: 0xff2222 })
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

      // Center indicator: owner's badge if available, red fill for foreign/NPC without badge
      const creepUserId = typeof obj.user === 'string' ? obj.user : undefined
      const creepBadge = creepUserId ? users?.[creepUserId]?.badge : undefined
      if (creepBadge && badgeCache) {
        const badgeSprite = new Sprite()
        badgeSprite.anchor.set(0.5, 0.5)
        const size = CREEP_INNER_R * 2
        badgeSprite.width = size
        badgeSprite.height = size
        badgeSprite.rotation = Math.PI / 2
        bodyContainer.addChild(badgeSprite)
        badgeCache.getOrCreate(creepBadge as Badge).then((texture) => {
          if (!badgeSprite.destroyed) {
            badgeSprite.texture = texture
          }
        }).catch(() => {})
      } else if (isForeign) {
        const markG = new Graphics()
        markG.circle(0, 0, CREEP_INNER_R * 0.82)
        markG.fill({ color: 0xcc1111, alpha: 0.8 })
        bodyContainer.addChild(markG)
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
    case 'spawn': {
      g.circle(cx, cy, TILE_SIZE * 0.65)
      g.fill(ST_DARK)
      g.circle(cx, cy, TILE_SIZE * 0.65)
      g.stroke({ width: TILE_SIZE * 0.1, color: 0xcccccc })
      g.circle(cx, cy, TILE_SIZE * 0.4)
      g.fill(ST_ENERGY)
      break
    }
    case 'powerSpawn': {
      g.circle(cx, cy, TILE_SIZE * 0.65)
      g.fill(ST_DARK)
      g.circle(cx, cy, TILE_SIZE * 0.65)
      g.stroke({ width: TILE_SIZE * 0.1, color: ST_POWER })
      g.circle(cx, cy, TILE_SIZE * 0.4)
      g.fill(ST_ENERGY)
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
      const level        = typeof obj.level         === 'number' ? obj.level         : 0
      const progress     = typeof obj.progress      === 'number' ? obj.progress      : 0
      const progressTotal = typeof obj.progressTotal === 'number' ? obj.progressTotal : 0

      // Octagon background
      const octoG = new Graphics()
      const octopts: number[] = []
      for (let i = 0; i < 8; i++) {
        const angle = -Math.PI / 2 + i * Math.PI / 4  // vertex at top
        octopts.push(cx + CTRL_OCTO_R * Math.cos(angle), cy + CTRL_OCTO_R * Math.sin(angle))
      }
      octoG.poly(octopts)
      octoG.fill(ST_DARK)
      octoG.poly(octopts)
      octoG.stroke({ width: TILE_SIZE * 0.05, color: 0x484848 })
      container.addChild(octoG)

      // Level / progress segments (dynamic)
      const segG = new Graphics()
      drawControllerSegments(segG, cx, cy, CTRL_SEG_OUT, CTRL_SEG_IN, level, progress, progressTotal)
      container.addChild(segG)
      ;(container as ContainerWithTarget).__ctrlSegGraphics   = segG
      ;(container as ContainerWithTarget).__ctrlLevel         = level
      ;(container as ContainerWithTarget).__ctrlProgress      = progress
      ;(container as ContainerWithTarget).__ctrlProgressTotal = progressTotal

      // Inner dark circle — fills exactly to segment inner edge
      const innerCircleG = new Graphics()
      innerCircleG.circle(cx, cy, CTRL_SEG_IN)
      innerCircleG.fill(ST_DARK)
      container.addChild(innerCircleG)

      // Owner badge — circular, fills inner area
      const ctrlUserId = typeof obj.user === 'string' ? obj.user : undefined
      const ctrlBadge = ctrlUserId ? users?.[ctrlUserId]?.badge : undefined
      if (ctrlBadge && badgeCache) {
        const bs = new Sprite()
        bs.anchor.set(0.5, 0.5)
        bs.width  = CTRL_SEG_IN * 2
        bs.height = CTRL_SEG_IN * 2
        bs.position.set(cx, cy)
        // Circular mask so the badge is round, not square
        const bsMask = new Graphics()
        bsMask.circle(cx, cy, CTRL_SEG_IN)
        bsMask.fill(0xffffff)
        container.addChild(bsMask)
        bs.mask = bsMask
        container.addChild(bs)
        badgeCache.getOrCreate(ctrlBadge as Badge).then((tex) => { if (!bs.destroyed) bs.texture = tex }).catch(() => {})
      }

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
    case 'wall': {
      g.circle(cx, cy, TILE_SIZE * 0.4)
      g.fill(ST_DARK)
      g.circle(cx, cy, TILE_SIZE * 0.4)
      g.stroke({ width: TILE_SIZE * 0.05, color: ST_LIGHT })
      break
    }
    case 'rampart': {
      // Intentionally left empty: rendering is batched in ObjectLayer's rampartGraphics
      // but we still need the empty container for selection tracking
      break
    }
    case 'tower': {
      const { energy: towerEnergy, capacity: towerCap } = getExtensionEnergy(obj)

      // Static outer circle
      const towerBase = new Graphics()
      towerBase.circle(cx, cy, TILE_SIZE * 0.6)
      towerBase.fill(ST_DARK)
      towerBase.circle(cx, cy, TILE_SIZE * 0.6)
      towerBase.stroke({ width: TILE_SIZE * 0.05, color: ST_OUTLINE })
      container.addChild(towerBase)

      // Rotating turret: body rect + energy fill + barrel — pivot at tile center
      const turret = new Container()
      turret.position.set(cx, cy)

      const towerBody = new Graphics()
      towerBody.rect(TOWER_BODY_X, TOWER_BODY_Y, TOWER_BODY_W, TOWER_BODY_H)
      towerBody.fill(ST_DARK)
      turret.addChild(towerBody)

      const towerFill = new Graphics()
      turret.addChild(towerFill)
      ;(container as ContainerWithTarget).__towerFillGraphics = towerFill as unknown as Graphics
      ;(container as ContainerWithTarget).__towerEnergy = towerEnergy
      ;(container as ContainerWithTarget).__towerCapacity = towerCap
      updateTowerFill(container as ContainerWithTarget, calcTowerFillHeight(towerEnergy, towerCap))

      const towerBorder = new Graphics()
      towerBorder.rect(TOWER_BODY_X, TOWER_BODY_Y, TOWER_BODY_W, TOWER_BODY_H)
      towerBorder.stroke({ width: 1, color: ST_GRAY })
      turret.addChild(towerBorder)

      const barrelG = new Graphics()
      barrelG.rect(-TILE_SIZE * 0.2, -TILE_SIZE * 0.9, TILE_SIZE * 0.4, TILE_SIZE * 0.5)
      barrelG.fill(ST_LIGHT)
      barrelG.rect(-TILE_SIZE * 0.2, -TILE_SIZE * 0.9, TILE_SIZE * 0.4, TILE_SIZE * 0.5)
      barrelG.stroke({ width: TILE_SIZE * 0.07, color: ST_DARK })
      turret.addChild(barrelG)

      container.addChild(turret)
      ;(container as ContainerWithTarget).__barrelContainer = turret
      break
    }
    case 'storage': {
      const storagePts = spts(cx, cy, [
        [-0.6, -0.7], [0, -0.8], [0.6, -0.7], [0.65, 0],
        [0.6, 0.7], [0, 0.8], [-0.6, 0.7], [-0.65, 0], [-0.6, -0.7],
      ])
      g.poly(storagePts)
      g.fill(ST_DARK)
      g.poly(storagePts)
      g.stroke({ width: TILE_SIZE * 0.05, color: ST_OUTLINE })
      g.rect(cx - TILE_SIZE * 0.5, cy - TILE_SIZE * 0.6, TILE_SIZE * 1.0, TILE_SIZE * 1.2)
      g.fill(ST_GRAY)
      g.rect(cx - TILE_SIZE * 0.5, cy - TILE_SIZE * 0.6, TILE_SIZE * 1.0, TILE_SIZE * 1.2)
      g.stroke({ width: TILE_SIZE * 0.1, color: ST_DARK })
      break
    }
    case 'terminal': {
      const termOuter = spts(cx, cy, [
        [0, -0.8], [0.55, -0.55], [0.8, 0], [0.55, 0.55],
        [0, 0.8], [-0.55, 0.55], [-0.8, 0], [-0.55, -0.55], [0, -0.8],
      ])
      const termInner = spts(cx, cy, [
        [0, -0.65], [0.45, -0.45], [0.65, 0], [0.45, 0.45],
        [0, 0.65], [-0.45, 0.45], [-0.65, 0], [-0.45, -0.45], [0, -0.65],
      ])
      g.poly(termOuter)
      g.fill(ST_DARK)
      g.poly(termOuter)
      g.stroke({ width: TILE_SIZE * 0.05, color: ST_OUTLINE })
      g.poly(termInner)
      g.fill(ST_LIGHT)
      g.rect(cx - TILE_SIZE * 0.45, cy - TILE_SIZE * 0.45, TILE_SIZE * 0.9, TILE_SIZE * 0.9)
      g.fill(ST_GRAY)
      g.rect(cx - TILE_SIZE * 0.45, cy - TILE_SIZE * 0.45, TILE_SIZE * 0.9, TILE_SIZE * 0.9)
      g.stroke({ width: TILE_SIZE * 0.1, color: ST_DARK })
      break
    }
    case 'link': {
      const linkOuter = spts(cx, cy, [[0, -0.5], [0.4, 0], [0, 0.5], [-0.4, 0], [0, -0.5]])
      const linkInner = spts(cx, cy, [[0, -0.3], [0.25, 0], [0, 0.3], [-0.25, 0], [0, -0.3]])
      g.poly(linkOuter)
      g.fill(ST_DARK)
      g.poly(linkOuter)
      g.stroke({ width: TILE_SIZE * 0.05, color: ST_OUTLINE })
      g.poly(linkInner)
      g.fill(ST_GRAY)
      break
    }
    case 'lab': {
      const labCy = cy - TILE_SIZE * 0.025
      g.circle(cx, labCy, TILE_SIZE * 0.55)
      g.fill(ST_DARK)
      g.circle(cx, labCy, TILE_SIZE * 0.55)
      g.stroke({ width: TILE_SIZE * 0.05, color: ST_OUTLINE })
      g.circle(cx, labCy, TILE_SIZE * 0.4)
      g.fill(ST_GRAY)
      g.rect(cx - TILE_SIZE * 0.45, cy + TILE_SIZE * 0.3, TILE_SIZE * 0.9, TILE_SIZE * 0.25)
      g.fill(ST_DARK)
      g.poly(spts(cx, cy, [[-0.45, 0.3], [-0.45, 0.55], [0.45, 0.55], [0.45, 0.3]]))
      g.stroke({ width: TILE_SIZE * 0.05, color: ST_OUTLINE })
      break
    }
    case 'container': {
      g.rect(cx - TILE_SIZE * 0.225, cy - TILE_SIZE * 0.3, TILE_SIZE * 0.45, TILE_SIZE * 0.6)
      g.fill(ST_ENERGY)
      g.rect(cx - TILE_SIZE * 0.225, cy - TILE_SIZE * 0.3, TILE_SIZE * 0.45, TILE_SIZE * 0.6)
      g.stroke({ width: TILE_SIZE * 0.1, color: ST_DARK })
      break
    }
    case 'observer': {
      g.circle(cx, cy, TILE_SIZE * 0.45)
      g.fill(ST_DARK)
      g.circle(cx, cy, TILE_SIZE * 0.45)
      g.stroke({ width: TILE_SIZE * 0.05, color: ST_OUTLINE })
      g.circle(cx + TILE_SIZE * 0.225, cy, TILE_SIZE * 0.2)
      g.fill(ST_OUTLINE)
      break
    }
    case 'nuker': {
      const nukerOuter = spts(cx, cy, [
        [0, -1], [-0.47, 0.2], [-0.5, 0.5], [0.5, 0.5], [0.47, 0.2], [0, -1],
      ])
      const nukerInner = spts(cx, cy, [
        [0, -0.8], [-0.4, 0.2], [0.4, 0.2], [0, -0.8],
      ])
      g.poly(nukerOuter)
      g.fill(ST_DARK)
      g.poly(nukerOuter)
      g.stroke({ width: TILE_SIZE * 0.05, color: ST_OUTLINE })
      g.poly(nukerInner)
      g.fill(ST_GRAY)
      g.poly(nukerInner)
      g.stroke({ width: TILE_SIZE * 0.01, color: ST_OUTLINE })
      break
    }
    case 'factory':
    case 'extractor':
    case 'invaderCore': {
      g.circle(cx, cy, TILE_SIZE * 0.45)
      g.fill(ST_DARK)
      g.circle(cx, cy, TILE_SIZE * 0.45)
      g.stroke({ width: TILE_SIZE * 0.05, color: ST_OUTLINE })
      g.circle(cx, cy, TILE_SIZE * 0.35)
      g.fill(ST_GRAY)
      break
    }
    case 'flag': {
      const colorIdx = typeof obj.color === 'number' ? obj.color : 0
      const secColorIdx = typeof obj.secondaryColor === 'number' ? obj.secondaryColor : 0
      const flagColor = FLAG_COLORS[colorIdx] ?? FLAG_COLORS[0]
      const secColor = FLAG_COLORS[secColorIdx] ?? FLAG_COLORS[0]
      const S = 1.5

      // Flag pole — centered in tile, 50% bigger
      const poleW = TILE_SIZE * 0.08 * S
      const poleH = TILE_SIZE * 0.7 * S
      const poleX = cx - poleW / 2
      const poleY = cy - TILE_SIZE * 0.25 * S
      g.rect(poleX, poleY, poleW, poleH)
      g.fill(0x888888)

      // One flag triangle split into upper (primary) and lower (secondary) halves
      const attachX = poleX + poleW
      const attachY = poleY
      const tipX = attachX + TILE_SIZE * 0.45 * S
      const topY = attachY
      const bottomY = attachY + TILE_SIZE * 0.44 * S
      const tipY = (topY + bottomY) / 2
      const splitY = tipY

      g.moveTo(attachX, topY)
      g.lineTo(tipX, tipY)
      g.lineTo(attachX, splitY)
      g.closePath()
      g.fill(flagColor)

      g.moveTo(attachX, splitY)
      g.lineTo(tipX, tipY)
      g.lineTo(attachX, bottomY)
      g.closePath()
      g.fill(secColor)

      container.addChild(g)

      // Label with flag name
      if (typeof obj.name === 'string') {
        const label = new Text({
          text: obj.name as string,
          style: { fontSize: LABEL_FONT_SIZE, fill: 0xffffff },
        })
        label.scale.set(LABEL_FONT_SCALE)
        label.anchor.set(0.5, 0)
        label.x = cx
        label.y = cy + TILE_SIZE * 0.55
        label.visible = showLabel
        ;(container as ContainerWithTarget).__nameLabel = label
        container.addChild(label)
      }
      break
    }
    default: {
      // Structures (fallback)
      const size = TILE_SIZE - 2
      g.rect(1, 1, size, size)
      g.fill(color)
    }
  }

  if (obj.type !== 'extension' && obj.type !== 'road' && obj.type !== 'creep' && obj.type !== 'tower' && obj.type !== 'controller' && obj.type !== 'flag') {
    container.addChild(g)
  }

  // Label for creeps — rendered at high font size, scaled down so it stays crisp when zoomed.
  // Base scale gives ~8px height at world-scale=1; ObjectLayer.tick() divides by world-scale
  // so the label stays constant in screen pixels and shrinks relative to the creep when zoomed in.
  if (obj.type === 'creep' && typeof obj.name === 'string') {
    const isForeign = isForeignCreep(obj, currentUserId)
    let labelText: string
    if (isForeign) {
      const userId = typeof obj.user === 'string' ? obj.user : undefined
      labelText = userId ? (users?.[userId]?.username ?? userId) : 'Hostile'
    } else {
      labelText = obj.name as string
    }
    const labelColor = isForeign ? 0xff2222 : 0xffffff
    const label = new Text({
      text: labelText,
      style: { fontSize: LABEL_FONT_SIZE, fill: labelColor },
    })
    label.scale.set(LABEL_FONT_SCALE)
    label.anchor.set(0.5, 1)
    label.x = cx
    label.y = LABEL_CREEP_TOP - LABEL_GAP_PX  // correct at world-scale=1; ticker adjusts on zoom
    label.visible = showLabel
    ;(container as ContainerWithTarget).__nameLabel = label
    container.addChild(label)
  }

  if (obj.type === 'creep') container.zIndex = 1
  if (obj.type === 'flag') container.zIndex = 10

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
  __towerFillGraphics?: Graphics
  __towerEnergy?: number
  __towerCapacity?: number
  __barrelContainer?: Container
  __ctrlSegGraphics?: Graphics
  __ctrlLevel?: number
  __ctrlProgress?: number
  __ctrlProgressTotal?: number
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
  private rampartGraphics: Graphics
  private ticker: Ticker | null = null
  private tickerCallback: (() => void) | null = null
  private extAnimations = new Map<string, ExtAnimation>()
  private creepFillAnimations = new Map<string, ExtAnimation>()
  private towerFillAnimations = new Map<string, ExtAnimation>()
  private readonly EXT_ANIM_DURATION = 300
  private lastWorldScale = 1
  private showLabels: boolean
  private currentUserId?: string
  private badge?: Badge
  private badgeCache = new BadgeTextureCache()
  private users?: Record<string, { _id: string; username: string }>

  constructor(ticker?: Ticker, showLabels = true, currentUserId?: string, badge?: Badge, users?: Record<string, { _id: string; username: string }>) {
    this.showLabels = showLabels
    this.currentUserId = currentUserId
    this.badge = badge
    this.users = users
    this.container = new Container()
    this.container.sortableChildren = true
    this.rampartGraphics = new Graphics()
    this.rampartGraphics.zIndex = -1
    this.container.addChild(this.rampartGraphics)
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

    // Label scale: invert world zoom so labels stay at constant screen size.
    // Relative to the (now larger) creep this makes them appear smaller on zoom-in.
    const worldScale = this.container.parent?.scale.x ?? 1
    if (worldScale !== this.lastWorldScale) {
      this.lastWorldScale = worldScale
      const s      = LABEL_FONT_SCALE / worldScale
      const labelY = LABEL_CREEP_TOP - LABEL_GAP_PX / worldScale
      for (const visual of this.objects.values()) {
        if (visual.__nameLabel) {
          visual.__nameLabel.scale.set(s)
          if (visual.__nameLabel.anchor.y === 0) {
            // Flag label — anchored at top, positioned below the flag
            visual.__nameLabel.y = TILE_SIZE / 2 + TILE_SIZE * 0.55
          } else {
            // Creep label — anchored at bottom, positioned above the creep
            visual.__nameLabel.y = labelY
          }
        }
      }
    }

    // Time-based animations (independent of game tick)
    const now = performance.now()
    const t_sec = now / 1000

    // Tower barrel rotation
    for (const visual of this.objects.values()) {
      if (visual.__barrelContainer) {
        visual.__barrelContainer.rotation = t_sec * 0.4  // ~23°/s idle sweep
      }
    }

    // Extension + creep fill animations
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
    for (const [id, anim] of this.towerFillAnimations) {
      const elapsed = now - anim.startTime
      const t = Math.min(1, elapsed / this.EXT_ANIM_DURATION)
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      updateTowerFill(anim.visual, anim.fromRadius + (anim.toRadius - anim.fromRadius) * ease)
      if (t >= 1) this.towerFillAnimations.delete(id)
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

  private startTowerFillAnimation(
    id: string,
    visual: ContainerWithTarget,
    fromEnergy: number,
    fromCapacity: number,
    toEnergy: number,
    toCapacity: number,
  ): void {
    const fromH = calcTowerFillHeight(fromEnergy, fromCapacity)
    const toH = calcTowerFillHeight(toEnergy, toCapacity)
    if (fromH === toH) return
    this.towerFillAnimations.set(id, { visual, fromRadius: fromH, toRadius: toH, startTime: performance.now() })
  }

  update(objects: RoomObjectMap, diff?: RoomObjectDiff, users?: Record<string, { _id: string; username: string }>): void {
    if (users) {
      this.users = users
    }
    let roadsChanged = false

    if (diff) {
      // Use for...in over Object.entries to avoid array allocation per tick
      for (const id in diff) {
        const changes = diff[id]
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
            this.towerFillAnimations.delete(id)
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
            const visual: ContainerWithTarget = createObjectVisual(obj, this.showLabels, this.currentUserId, this.badge, this.badgeCache, this.users)
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
            if (obj.type === 'tower') {
              const { energy, capacity } = getExtensionEnergy(obj)
              if (existing.__towerEnergy !== energy || existing.__towerCapacity !== capacity) {
                this.startTowerFillAnimation(id, existing, existing.__towerEnergy ?? 0, existing.__towerCapacity ?? capacity, energy, capacity)
                existing.__towerEnergy = energy
                existing.__towerCapacity = capacity
              }
            }
            if (obj.type === 'controller') {
              const level         = typeof obj.level         === 'number' ? obj.level         : 0
              const progress      = typeof obj.progress      === 'number' ? obj.progress      : 0
              const progressTotal = typeof obj.progressTotal === 'number' ? obj.progressTotal : 0
              if (existing.__ctrlLevel !== level || existing.__ctrlProgress !== progress || existing.__ctrlProgressTotal !== progressTotal) {
                if (existing.__ctrlSegGraphics) {
                  drawControllerSegments(existing.__ctrlSegGraphics, TILE_SIZE / 2, TILE_SIZE / 2, CTRL_SEG_OUT, CTRL_SEG_IN, level, progress, progressTotal)
                }
                existing.__ctrlLevel         = level
                existing.__ctrlProgress      = progress
                existing.__ctrlProgressTotal = progressTotal
              }
            }
          }
        }
      }
    } else {
      const seen = new Set<string>()

      // Use for...in to prevent unnecessary array allocation
      for (const id in objects) {
        const obj = objects[id]
        if (!obj) continue

        seen.add(id)
        this.rawObjects.set(id, obj)
        const existing = this.objects.get(id)
        if (!existing) {
          const visual: ContainerWithTarget = createObjectVisual(obj, this.showLabels, this.currentUserId, this.badge, this.badgeCache, this.users)
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
          if (obj.type === 'tower') {
            const { energy, capacity } = getExtensionEnergy(obj)
            if (existing.__towerEnergy !== energy || existing.__towerCapacity !== capacity) {
              this.startTowerFillAnimation(id, existing, existing.__towerEnergy ?? 0, existing.__towerCapacity ?? capacity, energy, capacity)
              existing.__towerEnergy = energy
              existing.__towerCapacity = capacity
            }
          }
          if (obj.type === 'controller') {
            const level         = typeof obj.level         === 'number' ? obj.level         : 0
            const progress      = typeof obj.progress      === 'number' ? obj.progress      : 0
            const progressTotal = typeof obj.progressTotal === 'number' ? obj.progressTotal : 0
            if (existing.__ctrlLevel !== level || existing.__ctrlProgress !== progress || existing.__ctrlProgressTotal !== progressTotal) {
              if (existing.__ctrlSegGraphics) {
                drawControllerSegments(existing.__ctrlSegGraphics, TILE_SIZE / 2, TILE_SIZE / 2, CTRL_SEG_OUT, CTRL_SEG_IN, level, progress, progressTotal)
              }
              existing.__ctrlLevel         = level
              existing.__ctrlProgress      = progress
              existing.__ctrlProgressTotal = progressTotal
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

    this.redrawRamparts()
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
    const radius = TILE_SIZE * 0.125

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

  private redrawRamparts(): void {
    this.rampartGraphics.clear()
    const T = TILE_SIZE
    const R = T / 2

    const grid = Array.from({ length: 50 }, () => new Array<string | undefined>(50).fill(undefined))
    for (const obj of this.rawObjects.values()) {
      if (obj.type === 'rampart' && obj.x >= 0 && obj.x < 50 && obj.y >= 0 && obj.y < 50) {
        grid[obj.x][obj.y] = typeof obj.user === 'string' ? obj.user : undefined
      }
    }

    const rampartColor = (user: string | undefined): { color: number; alpha: number } => {
      if (!user || !this.currentUserId) return { color: ST_RAMPART, alpha: 0.7 }
      return user === this.currentUserId
        ? { color: ST_RAMPART, alpha: 0.7 }
        : { color: 0x772222, alpha: 0.5 }
    }

    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 50; x++) {
        const centerUser = grid[x][y]
        const center = centerUser !== undefined
        const top = y > 0 && grid[x][y - 1] !== undefined
        const bottom = y < 49 && grid[x][y + 1] !== undefined
        const left = x > 0 && grid[x - 1][y] !== undefined
        const right = x < 49 && grid[x + 1][y] !== undefined

        const cx = x * T + R
        const cy = y * T + R

        // Top-Left Quadrant
        if (center) {
          const color = rampartColor(centerUser)
          if (!top && !left && y > 0 && x > 0) {
            this.rampartGraphics.moveTo(cx, y * T)
            this.rampartGraphics.arc(cx, cy, R, -Math.PI / 2, Math.PI, true)
            this.rampartGraphics.lineTo(cx, cy)
            this.rampartGraphics.fill(color)
          } else {
            this.rampartGraphics.rect(x * T, y * T, R, R)
            this.rampartGraphics.fill(color)
          }
        } else {
          if (top && left && grid[x - 1][y - 1] !== undefined) {
            const color = rampartColor(grid[x - 1][y - 1])
            this.rampartGraphics.moveTo(cx, y * T)
            this.rampartGraphics.lineTo(x * T, y * T)
            this.rampartGraphics.lineTo(x * T, cy)
            this.rampartGraphics.arc(cx, cy, R, Math.PI, -Math.PI / 2, false)
            this.rampartGraphics.fill(color)
          }
        }

        // Top-Right Quadrant
        if (center) {
          const color = rampartColor(centerUser)
          if (!top && !right && y > 0 && x < 49) {
            this.rampartGraphics.moveTo(cx, y * T)
            this.rampartGraphics.arc(cx, cy, R, -Math.PI / 2, 0, false)
            this.rampartGraphics.lineTo(cx, cy)
            this.rampartGraphics.fill(color)
          } else {
            this.rampartGraphics.rect(cx, y * T, R, R)
            this.rampartGraphics.fill(color)
          }
        } else {
          if (top && right && grid[x + 1][y - 1] !== undefined) {
            const color = rampartColor(grid[x + 1][y - 1])
            this.rampartGraphics.moveTo(cx, y * T)
            this.rampartGraphics.lineTo(x * T + T, y * T)
            this.rampartGraphics.lineTo(x * T + T, cy)
            this.rampartGraphics.arc(cx, cy, R, 0, -Math.PI / 2, true)
            this.rampartGraphics.fill(color)
          }
        }

        // Bottom-Left Quadrant
        if (center) {
          const color = rampartColor(centerUser)
          if (!bottom && !left && y < 49 && x > 0) {
            this.rampartGraphics.moveTo(x * T, cy)
            this.rampartGraphics.arc(cx, cy, R, Math.PI, Math.PI / 2, true)
            this.rampartGraphics.lineTo(cx, cy)
            this.rampartGraphics.fill(color)
          } else {
            this.rampartGraphics.rect(x * T, cy, R, R)
            this.rampartGraphics.fill(color)
          }
        } else {
          if (bottom && left && grid[x - 1][y + 1] !== undefined) {
            const color = rampartColor(grid[x - 1][y + 1])
            this.rampartGraphics.moveTo(x * T, cy)
            this.rampartGraphics.lineTo(x * T, y * T + T)
            this.rampartGraphics.lineTo(cx, y * T + T)
            this.rampartGraphics.arc(cx, cy, R, Math.PI / 2, Math.PI, false)
            this.rampartGraphics.fill(color)
          }
        }

        // Bottom-Right Quadrant
        if (center) {
          const color = rampartColor(centerUser)
          if (!bottom && !right && y < 49 && x < 49) {
            this.rampartGraphics.moveTo(cx, y * T + T)
            this.rampartGraphics.arc(cx, cy, R, Math.PI / 2, 0, true)
            this.rampartGraphics.lineTo(cx, cy)
            this.rampartGraphics.fill(color)
          } else {
            this.rampartGraphics.rect(cx, cy, R, R)
            this.rampartGraphics.fill(color)
          }
        } else {
          if (bottom && right && grid[x + 1][y + 1] !== undefined) {
            const color = rampartColor(grid[x + 1][y + 1])
            this.rampartGraphics.moveTo(cx, y * T + T)
            this.rampartGraphics.lineTo(x * T + T, y * T + T)
            this.rampartGraphics.lineTo(x * T + T, cy)
            this.rampartGraphics.arc(cx, cy, R, 0, Math.PI / 2, false)
            this.rampartGraphics.fill(color)
          }
        }
      }
    }
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
    this.towerFillAnimations.clear()
    this.roadGraphics.clear()
    this.rampartGraphics.clear()
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
