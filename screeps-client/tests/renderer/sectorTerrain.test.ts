import { describe, it, expect } from 'vitest'
import { SECTOR_ROOMS, SECTOR_PX, sectorOf, sectorRooms, sectorPixels } from '../../src/renderer/sectorTerrain'

const PLAIN = 0x112233
const WALL = 0x445566
const SWAMP = 0x778899
const colors = { plain: PLAIN, wall: WALL, swamp: SWAMP }

function rgba(pixels: Uint32Array, x: number, y: number): [number, number, number, number] {
  const v = pixels[y * SECTOR_PX + x]
  return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, v >>> 24]
}

function rgb(hex: number): [number, number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255]
}

describe('sectorOf', () => {
  it('groups room coordinates into 10x10 blocks, flooring negatives', () => {
    expect(sectorOf(0)).toBe(0)
    expect(sectorOf(9)).toBe(0)
    expect(sectorOf(10)).toBe(1)
    expect(sectorOf(-1)).toBe(-1)
    expect(sectorOf(-10)).toBe(-1)
    expect(sectorOf(-11)).toBe(-2)
  })
})

describe('sectorRooms', () => {
  it('lists the sector rooms row by row', () => {
    const rooms = sectorRooms(0, 0)
    expect(rooms).toHaveLength(SECTOR_ROOMS * SECTOR_ROOMS)
    expect(rooms[0]).toEqual({ rx: 0, ry: 0 })
    expect(rooms[1]).toEqual({ rx: 1, ry: 0 })
    expect(rooms[SECTOR_ROOMS]).toEqual({ rx: 0, ry: 1 })
    expect(sectorRooms(-1, 2)[0]).toEqual({ rx: -10, ry: 20 })
  })
})

describe('sectorPixels', () => {
  it('draws one opaque pixel per tile in the room terrain colour', () => {
    const raws: (Uint8Array | null)[] = Array(SECTOR_ROOMS * SECTOR_ROOMS).fill(null)
    const raw = new Uint8Array(2500)
    raw[0] = 1
    raw[1] = 2
    raw[50] = 0
    raws[SECTOR_ROOMS + 2] = raw

    const pixels = sectorPixels(raws, colors)
    expect(pixels).toHaveLength(SECTOR_PX * SECTOR_PX)
    expect(rgba(pixels, 100, 50)).toEqual(rgb(WALL))
    expect(rgba(pixels, 101, 50)).toEqual(rgb(SWAMP))
    expect(rgba(pixels, 100, 51)).toEqual(rgb(PLAIN))
  })

  it('fills rooms without terrain with the wall colour', () => {
    const raws: (Uint8Array | null)[] = Array(SECTOR_ROOMS * SECTOR_ROOMS).fill(null)
    const pixels = sectorPixels(raws, colors)
    expect(rgba(pixels, 0, 0)).toEqual(rgb(WALL))
    expect(rgba(pixels, SECTOR_PX - 1, SECTOR_PX - 1)).toEqual(rgb(WALL))
  })
})
