import { describe, it, expect } from 'vitest'
import type { RoomHistoryChunk } from 'screeps-connectivity'
import { HistoryPlayer } from '../../src/stores/HistoryPlayer'

function playerFor(ticks: RoomHistoryChunk['ticks']) {
  const http = { game: { roomHistory: async () => ({ ticks }) as RoomHistoryChunk } }
  return new HistoryPlayer('W1N1', null, http, 20)
}

const creep = {
  _id: 'c1',
  type: 'creep',
  x: 10,
  y: 10,
  body: [{ type: 'work', hits: 100 }, { type: 'move', hits: 100 }],
  store: { energy: 5, H: 2 },
}

describe('HistoryPlayer', () => {
  it('keeps body an array when a tick diffs it as an index-keyed object', async () => {
    const player = playerFor({
      '100': { c1: creep },
      '101': { c1: { body: { '0': { hits: 0 } } } },
    })

    const { objects } = await player.getStateAtTick(101)

    expect(objects.c1.body).toEqual([{ type: 'work', hits: 0 }, { type: 'move', hits: 100 }])
  })

  it('merges nested store diffs instead of replacing the whole store', async () => {
    const player = playerFor({
      '100': { c1: creep },
      '101': { c1: { store: { energy: 7 } } },
    })

    const { objects } = await player.getStateAtTick(101)

    expect(objects.c1.store).toEqual({ energy: 7, H: 2 })
  })

  it('drops fields the diff nulls out', async () => {
    const player = playerFor({
      '100': { c1: { ...creep, actionLog: { harvest: { x: 1, y: 1 } } } },
      '101': { c1: { actionLog: null } },
    })

    const { objects } = await player.getStateAtTick(101)

    expect(objects.c1).not.toHaveProperty('actionLog')
  })
})
