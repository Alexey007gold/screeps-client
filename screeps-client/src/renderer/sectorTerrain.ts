import { TerrainType } from 'screeps-connectivity'

export const SECTOR_ROOMS = 10
export const SECTOR_PX = SECTOR_ROOMS * 50
export const SECTOR_MAX_ROOM_SCREEN_PX = 37.5

export interface SectorColors {
  plain: number
  wall: number
  swamp: number
}

export function sectorOf(roomCoord: number): number {
  return Math.floor(roomCoord / SECTOR_ROOMS)
}

export function sectorRooms(sx: number, sy: number): { rx: number; ry: number }[] {
  const rooms: { rx: number; ry: number }[] = []
  for (let dy = 0; dy < SECTOR_ROOMS; dy++) {
    for (let dx = 0; dx < SECTOR_ROOMS; dx++) {
      rooms.push({ rx: sx * SECTOR_ROOMS + dx, ry: sy * SECTOR_ROOMS + dy })
    }
  }
  return rooms
}

function opaqueAbgr(hex: number): number {
  return (0xff000000 | ((hex & 0xff) << 16) | (hex & 0xff00) | ((hex >> 16) & 0xff)) >>> 0
}

export function sectorPixels(raws: readonly (Uint8Array | null)[], colors: SectorColors): Uint32Array<ArrayBuffer> {
  const byType: number[] = []
  byType[TerrainType.Plain] = opaqueAbgr(colors.plain)
  byType[TerrainType.Wall] = opaqueAbgr(colors.wall)
  byType[TerrainType.Swamp] = opaqueAbgr(colors.swamp)
  const wall = byType[TerrainType.Wall]

  const pixels = new Uint32Array(SECTOR_PX * SECTOR_PX).fill(wall)
  for (let r = 0; r < raws.length; r++) {
    const raw = raws[r]
    if (!raw) continue
    const ox = (r % SECTOR_ROOMS) * 50
    const oy = Math.floor(r / SECTOR_ROOMS) * 50
    for (let y = 0; y < 50; y++) {
      const row = (oy + y) * SECTOR_PX + ox
      for (let x = 0; x < 50; x++) {
        pixels[row + x] = byType[raw[y * 50 + x]] ?? wall
      }
    }
  }
  return pixels
}
