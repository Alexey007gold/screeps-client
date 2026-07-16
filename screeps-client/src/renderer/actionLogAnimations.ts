import type { RoomObjectMap } from 'screeps-connectivity'
import type { ActionAnimationLayer } from './ActionAnimationLayer.js'
import type { ObjectLayer } from './ObjectLayer.js'

// Queries a neighboring room (multi-room grid only) for the actionLog a creep carried
// when it arrived there this tick, so a departure can recover its own beam — see the
// recovery pass at the end of applyActionLogAnimations.
type NeighborActionLogLookup = (creepId: string, dirX: number, dirY: number) => Record<string, unknown> | null

// Draws whichever of the five creep target-beams are present in actionLog, from
// (fromX, fromY) — the creep's position in the frame these coordinates belong to.
// Shared by the live per-tick loop and the cross-room recovery pass below, which
// draws using a departed creep's exit tile instead of its (foreign-room) obj.x/y.
function renderCreepActionBeams(
  actionLog: Record<string, unknown>,
  fromX: number,
  fromY: number,
  animLayer: ActionAnimationLayer,
  objLayer: ObjectLayer,
  beamDuration: number,
): void {
  const harvest = actionLog.harvest as { x: number; y: number } | null | undefined
  if (harvest) {
    animLayer.addHarvest(harvest.x, harvest.y, fromX, fromY, beamDuration)
  }
  const upgrade = actionLog.upgradeController as { x: number; y: number } | null | undefined
  if (upgrade) {
    animLayer.addUpgradeController(fromX, fromY, upgrade.x, upgrade.y, beamDuration)
  }
  const build = actionLog.build as { x: number; y: number } | null | undefined
  if (build) {
    animLayer.addBuild(fromX, fromY, build.x, build.y, beamDuration)
    objLayer.triggerBuildAt(build.x, build.y, beamDuration)
  }
  const repair = actionLog.repair as { x: number; y: number } | null | undefined
  if (repair) {
    animLayer.addRepair(fromX, fromY, repair.x, repair.y, beamDuration)
  }
  const transfer = actionLog.transfer as { x: number; y: number } | null | undefined
  if (transfer) {
    animLayer.addTransfer(fromX, fromY, transfer.x, transfer.y, beamDuration)
  }
}

// Shared by RoomViewer (single-room view) and RoomScene (full-detail rooms in the
// multi-room grid) so both render identical action beams from the same actionLog data.
export function applyActionLogAnimations(
  objects: RoomObjectMap,
  animLayer: ActionAnimationLayer,
  objLayer: ObjectLayer,
  beamDuration: number,
  currentUserId: string | null | undefined,
  getNeighborActionLog?: NeighborActionLogLookup | null,
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

    // A creep that just crossed into this room this tick still carries the actionLog
    // entry from whatever it did in the room it left — the target coordinates belong
    // to that other room's tile grid, not this one. Rendering them here would draw a
    // beam to a bogus point in this room. objLayer already tracks this exact case for
    // the edge-handoff visual (see ObjectLayer.getFreshArrival), so reuse that signal
    // to skip the stale, foreign-room beams while still letting say bubbles through.
    // (In the multi-room grid, the room this creep left recovers the beam itself —
    // see the cross-room pass below.)
    const freshArrival = objLayer.getFreshArrival(id) != null

    if (!freshArrival) {
      renderCreepActionBeams(actionLog, obj.x, obj.y, animLayer, objLayer, beamDuration)
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

  // Multi-room grid only: recover the beam for a creep that acted here and crossed
  // into a neighboring room in the same tick. That neighbor received the actionLog
  // (its target coordinates are only valid in THIS room's frame) and skipped
  // rendering it via the freshArrival check above; this room still knows the exit
  // tile the creep was heading toward, so it can draw the beam correctly using its
  // own local coordinates. Only fires when that neighbor also happens to be
  // rendered in full detail — otherwise the beam is simply lost (see the "how does
  // this behave in single-room view" caveat: it isn't recoverable there).
  if (getNeighborActionLog) {
    for (const [id, exitTile] of objLayer.getFreshDepartures()) {
      const actionLog = getNeighborActionLog(id, exitTile.dirX, exitTile.dirY)
      if (!actionLog) continue
      renderCreepActionBeams(actionLog, exitTile.x, exitTile.y, animLayer, objLayer, beamDuration)
    }
  }

  objLayer.pruneSayBubblesExcept(sayingIds)
}
