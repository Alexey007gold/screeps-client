import { createSignal } from 'solid-js'
import type { RoomObject } from '@bastianh/screeps-connectivity'

export interface SelectedObject {
  id: string
  type: string
  name?: string
  x: number
  y: number
  raw: RoomObject
}

const [selection, setSelection] = createSignal<SelectedObject[]>([])

export { selection, setSelection }

export function clearSelection(): void {
  setSelection([])
}

export function deselectItem(id: string): void {
  setSelection((prev) => prev.filter((item) => item.id !== id))
}

export function updateSelectionWithDiff(
  diff: Record<string, Partial<RoomObject> | null>,
  objects: Record<string, RoomObject>
): void {
  setSelection((prev) => {
    let changed = false
    const next = prev.map((item) => {
      const itemDiff = diff[item.id]
      if (itemDiff !== undefined) {
        if (itemDiff === null) {
          changed = true
          return null
        } else {
          changed = true
          const updatedRaw = objects[item.id]
          return {
            ...item,
            raw: updatedRaw,
            x: updatedRaw.x,
            y: updatedRaw.y,
            name: typeof updatedRaw.name === 'string' ? updatedRaw.name : undefined,
          }
        }
      }
      return item
    }).filter((item) => item !== null) as SelectedObject[]

    return changed ? next : prev
  })
}
