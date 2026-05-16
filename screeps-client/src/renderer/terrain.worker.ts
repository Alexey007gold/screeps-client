import { TerrainType } from 'screeps-connectivity'

const TERRAIN_PLAIN = 0x2d333b
const TERRAIN_WALL = 0x0d1117
const TERRAIN_SWAMP = 0x3d5a3d

const LOD_SIZES = [128, 512]

function hexToRgba(hex: number, alpha: number = 255): [number, number, number, number] {
  return [
    (hex >> 16) & 255,
    (hex >> 8) & 255,
    hex & 255,
    alpha
  ]
}

const COLOR_PLAIN = hexToRgba(TERRAIN_PLAIN)
const COLOR_WALL = hexToRgba(TERRAIN_WALL)
const COLOR_SWAMP = hexToRgba(TERRAIN_SWAMP)

self.onmessage = (e: MessageEvent) => {
  const { id, roomName, lod, raw } = e.data as {
    id: number,
    roomName: string,
    lod: number,
    raw: Uint8Array
  }

  const size = LOD_SIZES[lod] || 128
  const tileSize = size / 50

  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D
  if (!ctx) return

  ctx.fillStyle = `rgb(${COLOR_PLAIN[0]}, ${COLOR_PLAIN[1]}, ${COLOR_PLAIN[2]})`
  ctx.fillRect(0, 0, size, size)

  ctx.fillStyle = `rgb(${COLOR_WALL[0]}, ${COLOR_WALL[1]}, ${COLOR_WALL[2]})`
  for (let i = 0; i < 2500; i++) {
    if (raw[i] === TerrainType.Wall) {
      const x = i % 50
      const y = Math.floor(i / 50)
      ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize)
    }
  }

  ctx.fillStyle = `rgb(${COLOR_SWAMP[0]}, ${COLOR_SWAMP[1]}, ${COLOR_SWAMP[2]})`
  for (let i = 0; i < 2500; i++) {
    if (raw[i] === TerrainType.Swamp) {
      const x = i % 50
      const y = Math.floor(i / 50)
      ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize)
    }
  }

  const bitmap = canvas.transferToImageBitmap()

  self.postMessage({ id, roomName, lod, bitmap }, { transfer: [bitmap] })
}
