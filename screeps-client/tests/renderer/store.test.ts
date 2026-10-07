import { describe, it, expect } from 'vitest'
import type { RoomObject } from 'screeps-connectivity'
import { getStoreBands } from '../../src/renderer/objects/store'
import { calcContainerFillHeight, CONT_H } from '../../src/renderer/objects/container'
import { DEPOSIT_COLORS, RESOURCE_COLORS, ST_ENERGY, ST_RESOURCE_OTHER } from '../../src/renderer/colors'

function container(store: Record<string, number> | undefined, storeCapacity?: number): RoomObject {
  return { _id: 'c1', type: 'container', x: 1, y: 1, room: 'W1N1', store, storeCapacity } as unknown as RoomObject
}

describe('getStoreBands', () => {
  it('uses the declared capacity when it is positive', () => {
    const { used, capacity } = getStoreBands(container({ energy: 500 }, 2000))
    expect(used).toBe(500)
    expect(capacity).toBe(2000)
  })

  it('treats a zero-capacity store holding resources as full', () => {
    const { used, capacity, bands, dominant } = getStoreBands(container({ energy: 100, XGH2O: 400 }, 0))
    expect(used).toBe(500)
    expect(capacity).toBe(500)
    expect(bands).toHaveLength(2)
    expect(dominant).toBe('XGH2O')
    expect(calcContainerFillHeight(used, capacity)).toBe(CONT_H)
  })

  it('tints bands by resource palette and falls back to white for unknown resources', () => {
    const { bands } = getStoreBands(container({ XUH2O: 10, metal: 20, crystal: 30, energy: 40 }, 0))
    expect(bands.map(b => b.color)).toEqual([
      ST_ENERGY,
      RESOURCE_COLORS.U,
      ST_RESOURCE_OTHER,
      DEPOSIT_COLORS.metal,
    ])
    expect(ST_RESOURCE_OTHER).toBe(0xFFFFFF)
  })

  it('treats a missing capacity with resources as full', () => {
    const { used, capacity } = getStoreBands(container({ power: 50 }))
    expect(capacity).toBe(used)
  })

  it('keeps an empty zero-capacity store empty', () => {
    const { used, capacity } = getStoreBands(container({}, 0))
    expect(used).toBe(0)
    expect(calcContainerFillHeight(used, capacity)).toBe(0)
  })
})
