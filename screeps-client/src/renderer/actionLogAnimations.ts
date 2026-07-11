import type { RoomObjectMap } from 'screeps-connectivity'
import type { ActionAnimationLayer } from './ActionAnimationLayer.js'
import type { ObjectLayer } from './ObjectLayer.js'

// Shared by RoomViewer (single-room view) and RoomScene (full-detail rooms in the
// multi-room grid) so both render identical action beams from the same actionLog data.
export function applyActionLogAnimations(
  objects: RoomObjectMap,
  animLayer: ActionAnimationLayer,
  objLayer: ObjectLayer,
  beamDuration: number,
  currentUserId: string | null | undefined,
): void {
  animLayer.clear()
  const sayingIds = new Set<string>()

  // Use for...in over Object.entries to avoid allocating a new array of arrays every tick
  for (const id in objects) {
    const obj = objects[id]
    if (!obj) continue
    const actionLog = obj.actionLog as Record<string, unknown> | null | undefined
    if (!actionLog) continue

    if (obj.type === 'tower') {
      const attack = actionLog.attack as { x: number; y: number } | null | undefined
      const heal = actionLog.heal as { x: number; y: number } | null | undefined
      const repair = actionLog.repair as { x: number; y: number } | null | undefined
      if (attack) animLayer.addTowerAttack(obj.x, obj.y, attack.x, attack.y, beamDuration)
      if (heal) animLayer.addTowerHeal(obj.x, obj.y, heal.x, heal.y, beamDuration)
      if (repair) animLayer.addTowerRepair(obj.x, obj.y, repair.x, repair.y, beamDuration)
      // Aim the barrel at whichever action fired this tick (one action per tick).
      const aim = attack ?? heal ?? repair
      if (aim) objLayer.triggerTowerAim(id, aim.x, aim.y, beamDuration)
      continue
    }

    if (obj.type === 'link') {
      // Source link records the destination position in actionLog.transferEnergy; the
      // receiving link gets no entry, so this fires exactly once per transfer.
      const linkTransfer = actionLog.transferEnergy as { x: number; y: number } | null | undefined
      if (linkTransfer) animLayer.addLinkTransfer(obj.x, obj.y, linkTransfer.x, linkTransfer.y, beamDuration)
      continue
    }

    if (obj.type === 'lab') {
      // The producing lab logs both input-lab positions as {x1,y1,x2,y2}; fire one beam
      // per input so both streams converge on this (the output) lab. reverseReaction is
      // the same shape for the unreaction. Only the producing lab carries the entry, so
      // each reaction animates exactly once.
      const reaction = (actionLog.runReaction ?? actionLog.reverseReaction) as
        { x1: number; y1: number; x2: number; y2: number } | null | undefined
      if (reaction) {
        animLayer.addLabReaction(reaction.x1, reaction.y1, obj.x, obj.y, beamDuration)
        animLayer.addLabReaction(reaction.x2, reaction.y2, obj.x, obj.y, beamDuration)
      }
      continue
    }

    if (obj.type !== 'creep') continue

    const harvest = actionLog.harvest as { x: number; y: number } | null | undefined
    if (harvest) {
      animLayer.addHarvest(harvest.x, harvest.y, obj.x, obj.y, beamDuration)
    }
    const upgrade = actionLog.upgradeController as { x: number; y: number } | null | undefined
    if (upgrade) {
      animLayer.addUpgradeController(obj.x, obj.y, upgrade.x, upgrade.y, beamDuration)
    }
    const build = actionLog.build as { x: number; y: number } | null | undefined
    if (build) {
      animLayer.addBuild(obj.x, obj.y, build.x, build.y, beamDuration)
      objLayer.triggerBuildAt(build.x, build.y, beamDuration)
    }
    const repair = actionLog.repair as { x: number; y: number } | null | undefined
    if (repair) {
      animLayer.addRepair(obj.x, obj.y, repair.x, repair.y, beamDuration)
    }
    const transfer = actionLog.transfer as { x: number; y: number } | null | undefined
    if (transfer) {
      animLayer.addTransfer(obj.x, obj.y, transfer.x, transfer.y, beamDuration)
    }
    const say = actionLog.say as { message?: unknown; isPublic?: boolean } | null | undefined
    if (say && typeof say.message === 'string' && say.message.length > 0) {
      // Non-public sayings are only visible to the creep's owner. The server may still
      // deliver them (private-server mods don't always filter), so guard here.
      const visible = say.isPublic === true || (currentUserId != null && obj.user === currentUserId)
      if (visible) {
        objLayer.triggerSay(id, say.message)
        sayingIds.add(id)
      }
    }
  }

  objLayer.pruneSayBubblesExcept(sayingIds)
}
