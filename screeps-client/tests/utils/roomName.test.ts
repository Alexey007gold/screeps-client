import { describe, it, expect } from 'vitest'
import { parseRoomName, formatRoomName, isRoomInWorld } from '../../src/utils/roomName'

describe('roomName utils', () => {
  describe('parseRoomName()', () => {
    it('parses typical room names correctly', () => {
      expect(parseRoomName('W1N1')).toEqual({ x: -2, y: -2 })
      expect(parseRoomName('E1S1')).toEqual({ x: 1, y: 1 })
      expect(parseRoomName('W5N12')).toEqual({ x: -6, y: -13 })
      expect(parseRoomName('E12S5')).toEqual({ x: 12, y: 5 })
    })

    it('parses origin room names correctly (W0, E0, N0, S0)', () => {
      expect(parseRoomName('W0N0')).toEqual({ x: -1, y: -1 })
      expect(parseRoomName('E0N0')).toEqual({ x: 0, y: -1 })
      expect(parseRoomName('W0S0')).toEqual({ x: -1, y: 0 })
      expect(parseRoomName('E0S0')).toEqual({ x: 0, y: 0 })
    })

    it('returns null for invalid or malformed room names', () => {
      expect(parseRoomName('w1n1')).toBeNull() // lowercase not allowed
      expect(parseRoomName('W-1N1')).toBeNull() // no negative numbers
      expect(parseRoomName('N1W1')).toBeNull() // order must be EW then NS
      expect(parseRoomName('E1')).toBeNull() // missing NS
      expect(parseRoomName('N1')).toBeNull() // missing EW
      expect(parseRoomName('invalid')).toBeNull()
      expect(parseRoomName('')).toBeNull()
      expect(parseRoomName('W1N1x')).toBeNull() // extra characters
    })
  })

  describe('formatRoomName()', () => {
    it('formats typical room coordinates correctly', () => {
      expect(formatRoomName(-2, -2)).toBe('W1N1')
      expect(formatRoomName(1, 1)).toBe('E1S1')
      expect(formatRoomName(-6, -13)).toBe('W5N12')
      expect(formatRoomName(12, 5)).toBe('E12S5')
    })

    it('formats origin room coordinates correctly', () => {
      expect(formatRoomName(-1, -1)).toBe('W0N0')
      expect(formatRoomName(0, -1)).toBe('E0N0')
      expect(formatRoomName(-1, 0)).toBe('W0S0')
      expect(formatRoomName(0, 0)).toBe('E0S0')
    })
  })

  describe('isRoomInWorld()', () => {
    it('returns true if any bounds are NaN', () => {
      expect(isRoomInWorld(5, 5, { minX: NaN, maxX: 10, minY: 0, maxY: 10 } as any)).toBe(true)
      expect(isRoomInWorld(5, 5, { minX: 0, maxX: NaN, minY: 0, maxY: 10 } as any)).toBe(true)
      expect(isRoomInWorld(5, 5, { minX: 0, maxX: 10, minY: NaN, maxY: 10 } as any)).toBe(true)
      expect(isRoomInWorld(5, 5, { minX: 0, maxX: 10, minY: 0, maxY: NaN } as any)).toBe(true)
    })

    it('returns true when coordinates are within bounds', () => {
      const bounds = { minX: -10, maxX: 10, minY: -10, maxY: 10 } as any
      expect(isRoomInWorld(0, 0, bounds)).toBe(true)
      expect(isRoomInWorld(-10, -10, bounds)).toBe(true)
      expect(isRoomInWorld(10, 10, bounds)).toBe(true)
      expect(isRoomInWorld(-5, 5, bounds)).toBe(true)
    })

    it('returns false when coordinates are outside bounds', () => {
      const bounds = { minX: -10, maxX: 10, minY: -10, maxY: 10 } as any
      expect(isRoomInWorld(-11, 0, bounds)).toBe(false)
      expect(isRoomInWorld(11, 0, bounds)).toBe(false)
      expect(isRoomInWorld(0, -11, bounds)).toBe(false)
      expect(isRoomInWorld(0, 11, bounds)).toBe(false)
      expect(isRoomInWorld(-15, 15, bounds)).toBe(false)
    })
  })
})
