import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { KeyboardPan, KEYBOARD_PAN_SPEED, clampPan } from '../../src/renderer/KeyboardPan'

describe('clampPan', () => {
  it('moves freely inside the limits', () => {
    expect(clampPan(30, 20, 0, 100)).toBe(30)
  })

  it('stops at the limit it crosses', () => {
    expect(clampPan(110, 90, 0, 100)).toBe(100)
    expect(clampPan(-10, 10, 0, 100)).toBe(0)
  })

  it('does not snap a position already past a limit, only blocks going further out', () => {
    expect(clampPan(130, 120, 0, 100)).toBe(120)
    expect(clampPan(110, 120, 0, 100)).toBe(110)
  })
})

function key(type: 'keydown' | 'keyup', code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}): Event {
  return Object.assign(new Event(type), { code, ctrlKey: false, metaKey: false, altKey: false, ...mods })
}

describe('KeyboardPan', () => {
  let target: EventTarget
  let pan: KeyboardPan

  beforeEach(() => {
    target = new EventTarget()
    pan = new KeyboardPan(target)
  })

  afterEach(() => pan.destroy())

  it('does not move while no key is held', () => {
    expect(pan.step(1000)).toBeNull()
  })

  it.each([
    ['KeyW', 0, 1],
    ['KeyS', 0, -1],
    ['KeyA', 1, 0],
    ['KeyD', -1, 0],
  ])('%s moves the world by (%i, %i) * speed per second', (code, sx, sy) => {
    target.dispatchEvent(key('keydown', code))
    expect(pan.step(1000)).toEqual({ dx: sx * KEYBOARD_PAN_SPEED, dy: sy * KEYBOARD_PAN_SPEED })
  })

  it('scales movement by elapsed time', () => {
    target.dispatchEvent(key('keydown', 'KeyD'))
    expect(pan.step(500)?.dx).toBeCloseTo(-KEYBOARD_PAN_SPEED / 2)
  })

  it('keeps diagonal speed equal to straight speed', () => {
    target.dispatchEvent(key('keydown', 'KeyW'))
    target.dispatchEvent(key('keydown', 'KeyD'))
    const step = pan.step(1000)!
    expect(Math.hypot(step.dx, step.dy)).toBeCloseTo(KEYBOARD_PAN_SPEED)
  })

  it('cancels out opposite keys', () => {
    target.dispatchEvent(key('keydown', 'KeyA'))
    target.dispatchEvent(key('keydown', 'KeyD'))
    expect(pan.step(1000)).toBeNull()
  })

  it('stops when the key is released', () => {
    target.dispatchEvent(key('keydown', 'KeyW'))
    target.dispatchEvent(key('keyup', 'KeyW'))
    expect(pan.step(1000)).toBeNull()
  })

  it('ignores shortcuts with modifiers and drops held keys when one is pressed', () => {
    target.dispatchEvent(key('keydown', 'KeyS', { metaKey: true }))
    expect(pan.step(1000)).toBeNull()

    target.dispatchEvent(key('keydown', 'KeyW'))
    target.dispatchEvent(key('keydown', 'MetaLeft', { metaKey: true }))
    expect(pan.step(1000)).toBeNull()
  })

  it('ignores keys typed into inputs', () => {
    const ev = key('keydown', 'KeyW')
    Object.defineProperty(ev, 'target', { value: { tagName: 'INPUT' } })
    target.dispatchEvent(ev)
    expect(pan.step(1000)).toBeNull()
  })

  it('releases everything when the window loses focus', () => {
    target.dispatchEvent(key('keydown', 'KeyW'))
    target.dispatchEvent(new Event('blur'))
    expect(pan.step(1000)).toBeNull()
  })

  it('stops listening after destroy', () => {
    pan.destroy()
    target.dispatchEvent(key('keydown', 'KeyW'))
    expect(pan.step(1000)).toBeNull()
  })
})
