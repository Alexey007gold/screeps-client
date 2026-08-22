import { LS, boolSetting } from '~/utils/storage.js'

export const [widescreenMode, setWidescreenMode] = boolSetting(LS.widescreenMode, true)
export const [showCreepLabels, setShowCreepLabels] = boolSetting(LS.showCreepLabels, true)
export const [showMapRoomNames, setShowMapRoomNames] = boolSetting(LS.showMapRoomNames, false)
export const [showUnclaimableRooms, setShowUnclaimableRooms] = boolSetting(LS.showUnclaimableRooms, true)
export const [terrainEffects, setTerrainEffects] = boolSetting(LS.terrainEffects, true)
export const [showRoomDecorations, setShowRoomDecorations] = boolSetting(LS.showRoomDecorations, true)
export const [roomDarkOverlay, setRoomDarkOverlay] = boolSetting(LS.roomDarkOverlay, true)
export const [showRoomVisuals, setShowRoomVisuals] = boolSetting(LS.showRoomVisuals, true)
// When off, tick-driven animations (creep movement, fill tweens, build glows, cooldown
// pulses) snap instantly instead of interpolating between ticks. Wall-clock ambient
// pulses (source glow, tower sweep, keeper-lair glow) are unaffected.
export const [smoothAnimations, setSmoothAnimations] = boolSetting(LS.smoothAnimations, true)
export const [showMapVisuals, setShowMapVisuals] = boolSetting(LS.showMapVisuals, true)
export const [hideCustomUiProtocol, setHideCustomUiProtocol] = boolSetting(LS.hideCustomUiProtocol, true)
