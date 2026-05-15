import { createSignal } from 'solid-js'

function boolSetting(key: string, defaultVal: boolean): [() => boolean, (v: boolean) => void] {
  const stored = localStorage.getItem(key)
  const [val, setVal] = createSignal(stored !== null ? stored === 'true' : defaultVal)
  return [val, (v: boolean) => { setVal(v); localStorage.setItem(key, String(v)) }]
}

export const [widescreenMode, setWidescreenMode] = boolSetting('screeps:settings:widescreenMode', true)
export const [showCreepLabels, setShowCreepLabels] = boolSetting('screeps:settings:showCreepLabels', true)
export const [showMapRoomNames, setShowMapRoomNames] = boolSetting('screeps:settings:showMapRoomNames', false)
