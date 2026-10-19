import { describe, it, expect, beforeEach } from 'vitest'
import type { RoomObject } from 'screeps-connectivity'
import {
  createSelectedObject, setSelection, selection, updateSelectionFromObjects, updateSelectionWithDiff,
} from '../../src/stores/selectionStore'

function creepAt(hits: number): RoomObject {
  return {
    _id: 'c1',
    type: 'creep',
    x: 10,
    y: 10,
    body: [{ type: 'work', hits }, { type: 'move', hits: 100 }],
    store: { energy: hits },
  }
}

describe('selectionStore', () => {
  beforeEach(() => setSelection([]))

  it('does not mutate the object it was created from when later ticks arrive', () => {
    const selectedAt = creepAt(100)
    setSelection([createSelectedObject('c1', selectedAt)])

    updateSelectionFromObjects({ c1: creepAt(40) })

    expect(selectedAt).toEqual(creepAt(100))
    expect(selection()[0].raw.body).toEqual(creepAt(40).body)
  })

  it('does not mutate objects from earlier updates when applying a diff', () => {
    setSelection([createSelectedObject('c1', creepAt(100))])
    const tick1 = { ...creepAt(70), actionLog: { harvest: { x: 1, y: 1 } } }
    updateSelectionWithDiff({ c1: { actionLog: tick1.actionLog } }, { c1: tick1 })

    const tick2 = { ...creepAt(70), actionLog: { harvest: { x: 2, y: 2 } } }
    updateSelectionWithDiff({ c1: { actionLog: { harvest: { x: 2, y: 2 } } } }, { c1: tick2 })

    expect(tick1.actionLog).toEqual({ harvest: { x: 1, y: 1 } })
    expect(selection()[0].raw.actionLog).toEqual({ harvest: { x: 2, y: 2 } })
  })
})
