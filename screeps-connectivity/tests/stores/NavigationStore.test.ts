import { describe, it, expect } from 'vitest'
import { NavigationStore } from '../../src/stores/NavigationStore.js'

function makeStore(maxHistory = 50) {
  return new NavigationStore(maxHistory)
}

describe('NavigationStore', () => {
  it('current() returns null room/shard before any navigation', () => {
    const store = makeStore()
    const state = store.current()
    expect(state.room).toBeNull()
    expect(state.shard).toBeNull()
    expect(state.index).toBe(-1)
    expect(state.history).toHaveLength(0)
  })

  it('navigateTo() appends to history and emits navigation:change', () => {
    const store = makeStore()
    const events: Array<{ room: string | null; shard: string | null }> = []
    store.on('navigation:change', e => events.push(e))

    store.navigateTo('W7N7', 'shard0')
    expect(events).toHaveLength(1)
    expect(events[0].room).toBe('W7N7')
    expect(events[0].shard).toBe('shard0')
  })

  it('navigateTo() updates current() and history', () => {
    const store = makeStore()
    store.navigateTo('W1N1', null)
    store.navigateTo('W7N7', 'shard0')

    const state = store.current()
    expect(state.room).toBe('W7N7')
    expect(state.shard).toBe('shard0')
    expect(state.index).toBe(1)
    expect(state.history).toHaveLength(2)
  })

  it('canBack() is false before any navigation', () => {
    const store = makeStore()
    expect(store.canBack()).toBe(false)
  })

  it('canBack() is false with only one entry', () => {
    const store = makeStore()
    store.navigateTo('W1N1', null)
    expect(store.canBack()).toBe(false)
  })

  it('canBack() is true after two navigations', () => {
    const store = makeStore()
    store.navigateTo('W1N1', null)
    store.navigateTo('W7N7', null)
    expect(store.canBack()).toBe(true)
  })

  it('back() returns false and does nothing when at start', () => {
    const store = makeStore()
    store.navigateTo('W1N1', null)
    const result = store.back()
    expect(result).toBe(false)
    expect(store.current().room).toBe('W1N1')
  })

  it('back() moves to previous entry and emits', () => {
    const store = makeStore()
    store.navigateTo('W1N1', null)
    store.navigateTo('W7N7', null)

    const events: string[] = []
    store.on('navigation:change', e => events.push(e.room ?? ''))

    store.back()
    expect(store.current().room).toBe('W1N1')
    expect(events).toEqual(['W1N1'])
  })

  it('canForward() is false when at the end of history', () => {
    const store = makeStore()
    store.navigateTo('W1N1', null)
    store.navigateTo('W7N7', null)
    expect(store.canForward()).toBe(false)
  })

  it('canForward() is true after going back', () => {
    const store = makeStore()
    store.navigateTo('W1N1', null)
    store.navigateTo('W7N7', null)
    store.back()
    expect(store.canForward()).toBe(true)
  })

  it('forward() moves to next entry and emits', () => {
    const store = makeStore()
    store.navigateTo('W1N1', null)
    store.navigateTo('W7N7', null)
    store.back()

    const events: string[] = []
    store.on('navigation:change', e => events.push(e.room ?? ''))

    store.forward()
    expect(store.current().room).toBe('W7N7')
    expect(events).toEqual(['W7N7'])
  })

  it('forward() returns false and does nothing when at end', () => {
    const store = makeStore()
    store.navigateTo('W1N1', null)
    const result = store.forward()
    expect(result).toBe(false)
    expect(store.current().room).toBe('W1N1')
  })

  it('navigateTo() after back() truncates forward entries', () => {
    const store = makeStore()
    store.navigateTo('W1N1', null)
    store.navigateTo('W7N7', null)
    store.navigateTo('W8N8', null)
    store.back()
    store.back()
    // now at index 0, can forward to W7N7 and W8N8
    expect(store.canForward()).toBe(true)

    store.navigateTo('W2N2', null)  // truncates W7N7 and W8N8
    expect(store.canForward()).toBe(false)
    expect(store.current().room).toBe('W2N2')
    expect(store.current().history).toHaveLength(2)  // W1N1, W2N2
  })

  it('history is bounded to maxHistory entries', () => {
    const store = makeStore(3)
    store.navigateTo('W1N1', null)
    store.navigateTo('W2N2', null)
    store.navigateTo('W3N3', null)
    store.navigateTo('W4N4', null)  // evicts W1N1

    const state = store.current()
    expect(state.history).toHaveLength(3)
    expect(state.history[0].room).toBe('W2N2')
    expect(state.room).toBe('W4N4')
  })

  it('back() still works after history bound is reached', () => {
    const store = makeStore(2)
    store.navigateTo('W1N1', null)
    store.navigateTo('W2N2', null)
    store.navigateTo('W3N3', null)  // evicts W1N1, history=[W2N2, W3N3]

    expect(store.canBack()).toBe(true)
    store.back()
    expect(store.current().room).toBe('W2N2')
    expect(store.canBack()).toBe(false)
  })

  it('current() returns a snapshot — modifying it does not affect store', () => {
    const store = makeStore()
    store.navigateTo('W1N1', null)
    const state = store.current()
    state.history.push({ room: 'W9N9', shard: null })

    expect(store.current().history).toHaveLength(1)
  })
})
