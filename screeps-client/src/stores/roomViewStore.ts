// screeps-client/src/stores/roomViewStore.ts
import { createSignal } from 'solid-js'

export type RoomViewMode = 'view' | 'flag' | 'build'

export interface FlagDraft {
    name: string
    color: string
    secondaryColor: string
}

export const FLAG_COLOR_MAP: Record<string, number> = {
  COLOR_RED: 1,
  COLOR_PURPLE: 2,
  COLOR_BLUE: 3,
  COLOR_CYAN: 4,
  COLOR_GREEN: 5,
  COLOR_YELLOW: 6,
  COLOR_ORANGE: 7,
  COLOR_BROWN: 8,
  COLOR_GREY: 9,
  COLOR_WHITE: 10,
}

export interface PendingTile {
  tx: number
  ty: number
}

const [roomViewMode, setRoomViewMode] = createSignal<RoomViewMode>('view')
const [flagDraft, setFlagDraft] = createSignal<FlagDraft>({
    name: '',
    color: 'COLOR_WHITE',
    secondaryColor: 'COLOR_WHITE',
})
const [pendingTile, setPendingTile] = createSignal<PendingTile | null>(null)

export { roomViewMode, setRoomViewMode, flagDraft, setFlagDraft, pendingTile, setPendingTile }

export function clearPendingTile(): void {
  setPendingTile(null)
}

export function resetRoomViewMode(): void {
    setRoomViewMode('view')
    clearPendingTile()
}