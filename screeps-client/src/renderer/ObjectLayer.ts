import { Container, Graphics, Text, Ticker, Sprite } from 'pixi.js'
import type { RoomObject, RoomObjectMap, RoomObjectDiff, Badge } from 'screeps-connectivity'
import { BadgeTextureCache } from './BadgeTextureCache.js'
import { TILE_SIZE } from './RoomRenderer.js'
import {
  BODY_PART_COLORS,
  OBJECT_COLORS,
  BG_DEEP, BG_DARK,
  OBJ_DEFAULT, OBJ_ROAD, OBJ_GOLD,
  ENERGY_FILL,
  CREEP_RING_DARK, CREEP_NOTCH,
  ST_DARK, ST_GRAY, ST_LIGHT, ST_OUTLINE, ST_ENERGY, ST_POWER, ST_RAMPART, ST_RAMPART_STROKE,
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
const CTRL_GEM_R   = CTRL_SEG_IN * 0.65

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

function drawControllerGem(g: Graphics, cx: number, cy: number, r: number): void {
  // dark shadow ring
  g.circle(cx, cy, r + 0.5)
  g.fill(0x080818)
  // main dark-blue body
  g.moveTo(cx,           cy - r)
  g.lineTo(cx + r,       cy - r * 0.2)
  g.lineTo(cx + r * 0.6, cy + r)
  g.lineTo(cx - r * 0.6, cy + r)
  g.lineTo(cx - r,       cy - r * 0.2)
  g.closePath()
  g.fill(0x1c1c8c)
  // upper-left facet: medium blue
  g.moveTo(cx, cy - r)
  g.lineTo(cx - r, cy - r * 0.2)
  g.lineTo(cx - r * 0.1, cy + r * 0.15)
  g.closePath()
  g.fill(0x4545cc)
  // upper-right facet: slightly darker
  g.moveTo(cx, cy - r)
  g.lineTo(cx + r, cy - r * 0.2)
  g.lineTo(cx + r * 0.1, cy - r * 0.3)
  g.closePath()
  g.fill(0x2828a8)
  // bright highlight near top-left
  g.moveTo(cx - r * 0.25, cy - r * 0.82)
  g.lineTo(cx - r * 0.72, cy - r * 0.08)
  g.lineTo(cx - r * 0.02, cy - r * 0.22)
  g.closePath()
  g.fill(0x7878ee)
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

      // Center indicator: badge for own creep, red fill for foreign/NPC
      const isOwn = !isForeign
      if (isForeign) {
        const markG = new Graphics()
        markG.circle(0, 0, CREEP_INNER_R * 0.82)
        markG.fill({ color: 0xcc1111, alpha: 0.8 })
        bodyContainer.addChild(markG)
      }
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

      // Owner badge — circular, fills inner area (own controller only)
      if (currentUserId && (obj.user as string | undefined) === currentUserId && badge && badgeCache) {
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
        badgeCache.getOrCreate(badge).then((tex) => { if (!bs.destroyed) bs.texture = tex }).catch(() => {})
      }

      // Gem crystal on top
      const gemG = new Graphics()
      drawControllerGem(gemG, cx, cy, CTRL_GEM_R)
      container.addChild(gemG)

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
      g.circle(cx, cy, TILE_SIZE * 0.65)
      g.fill(ST_RAMPART)
      g.circle(cx, cy, TILE_SIZE * 0.65)
      g.stroke({ width: TILE_SIZE * 0.1, color: ST_RAMPART_STROKE })
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
    default: {
      // Structures (fallback)
      const size = TILE_SIZE - 2
      g.rect(1, 1, size, size)
      g.fill(color)
    }
  }

  if (obj.type !== 'extension' && obj.type !== 'road' && obj.type !== 'creep' && obj.type !== 'tower' && obj.type !== 'controller') {
    container.addChild(g)
  }

  // Label for creeps — rendered at high font size, scaled down so it stays crisp when zoomed.
  // Base scale gives ~8px height at world-scale=1; ObjectLayer.tick() divides by world-scale
  // so the label stays constant in screen pixels and shrinks relative to the creep when zoomed in.
  if (obj.type === 'creep' && typeof obj.name === 'string') {
    const label = new Text({
      text: obj.name as string,
      style: { fontSize: LABEL_FONT_SIZE, fill: 0xffffff },
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
          visual.__nameLabel.y = labelY
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
    const radius = TILE_SIZE * 0.175

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
    this.towerFillAnimations.clear()
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
