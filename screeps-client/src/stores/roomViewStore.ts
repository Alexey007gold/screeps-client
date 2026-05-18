// screeps-client/src/stores/roomViewStore.ts
import { createSignal } from 'solid-js'

export type RoomViewMode = 'view' | 'flag' | 'build'

export interface FlagDraft {
    name: string
    color: string
    secondaryColor: string
}

export const FLAG_COLOR_MAP: Record<string, number> = {
  COLOR_WHITE: 0,
  COLOR_GREY: 1,
  COLOR_RED: 2,
  COLOR_PURPLE: 3,
  COLOR_BLUE: 4,
  COLOR_CYAN: 5,
  COLOR_GREEN: 6,
  COLOR_YELLOW: 7,
  COLOR_ORANGE: 8,
  COLOR_BROWN: 9,
}

const [roomViewMode, setRoomViewMode] = createSignal<RoomViewMode>('view')
const [flagDraft, setFlagDraft] = createSignal<FlagDraft>({
    name: '',
    color: 'COLOR_WHITE',
    secondaryColor: 'COLOR_WHITE',
})

export { roomViewMode, setRoomViewMode, flagDraft, setFlagDraft }

export function resetRoomViewMode(): void {
    setRoomViewMode('view')
}