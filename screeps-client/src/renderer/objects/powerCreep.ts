import { Container, Graphics } from 'pixi.js'
import type { RoomObject } from 'screeps-connectivity'
import { BG_DARK, BG_DEEP, CREEP_RING_DARK, OBJ_FOREIGN, ST_POWER } from '../colors.js'
import { CREEP_IDLE_FACING, CREEP_INNER_R, CREEP_OUTER_R, attachCreepCore, attachCreepNameLabel, drawCreepArc, isForeignCreep } from './creep.js'
import type { ContainerWithTarget, VisualBuildContext } from './types.js'

export function powerCreepHitsRatio(obj: RoomObject): number {
  const hits = typeof obj.hits === 'number' ? obj.hits : 0
  const hitsMax = typeof obj.hitsMax === 'number' ? obj.hitsMax : 0
  if (hitsMax <= 0) return 1
  return Math.max(0, Math.min(1, hits / hitsMax))
}

export function drawPowerCreepRing(g: Graphics, ratio: number): void {
  g.clear()
  const half = Math.PI * ratio
  drawCreepArc(g, half, 2 * Math.PI - half, CREEP_RING_DARK)
  drawCreepArc(g, -half, half, ST_POWER)
}

export function createPowerCreepVisual(ctx: VisualBuildContext): void {
  const { obj, container, cx, cy, currentUserId } = ctx
  const visual = container as ContainerWithTarget

  const bodyContainer = new Container()
  bodyContainer.position.set(cx, cy)
  bodyContainer.rotation = CREEP_IDLE_FACING

  const isForeign = isForeignCreep(obj, currentUserId)
  if (isForeign) {
    const borderG = new Graphics()
    borderG.circle(0, 0, CREEP_OUTER_R + 0.75)
    borderG.stroke({ width: 1.5, color: OBJ_FOREIGN })
    bodyContainer.addChild(borderG)
  }

  const bgG = new Graphics()
  bgG.circle(0, 0, CREEP_OUTER_R)
  bgG.fill(BG_DEEP)
  bodyContainer.addChild(bgG)

  const ratio = powerCreepHitsRatio(obj)
  const ringG = new Graphics()
  drawPowerCreepRing(ringG, ratio)
  bodyContainer.addChild(ringG)
  visual.__powerRingGraphics = ringG
  visual.__powerHitsRatio = ratio

  const innerG = new Graphics()
  innerG.circle(0, 0, CREEP_INNER_R)
  innerG.fill(BG_DARK)
  bodyContainer.addChild(innerG)

  attachCreepCore(ctx, bodyContainer, isForeign)

  container.addChild(bodyContainer)
  visual.__bodyContainer = bodyContainer

  attachCreepNameLabel(ctx)
}
