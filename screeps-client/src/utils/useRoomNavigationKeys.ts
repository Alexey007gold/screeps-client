import { onCleanup } from 'solid-js'
import { parseRoomName, isRoomInWorld } from './roomName.js'
import type { WorldInfo } from '@bastianh/screeps-connectivity'

interface UseRoomNavigationKeysOptions {
  currentRoom: () => string | null
  worldBounds: () => WorldInfo | null
  onMove: (rx: number, ry: number) => void
}

export function useRoomNavigationKeys(opts: UseRoomNavigationKeysOptions): void {
  const onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName ?? ''
    const editable = (e.target as HTMLElement | null)?.isContentEditable ?? false
    if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return

    const cur = opts.currentRoom()
    const coord = cur ? parseRoomName(cur) : null
    if (!coord) return

    const bounds = opts.worldBounds()
    const inBounds = (nx: number, ny: number) => !bounds || isRoomInWorld(nx, ny, bounds)

    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); if (inBounds(coord.x - 1, coord.y)) opts.onMove(coord.x - 1, coord.y); break
      case 'ArrowRight': e.preventDefault(); if (inBounds(coord.x + 1, coord.y)) opts.onMove(coord.x + 1, coord.y); break
      case 'ArrowUp':    e.preventDefault(); if (inBounds(coord.x, coord.y - 1)) opts.onMove(coord.x, coord.y - 1); break
      case 'ArrowDown':  e.preventDefault(); if (inBounds(coord.x, coord.y + 1)) opts.onMove(coord.x, coord.y + 1); break
    }
  }

  window.addEventListener('keydown', onKeyDown)
  onCleanup(() => window.removeEventListener('keydown', onKeyDown))
}
