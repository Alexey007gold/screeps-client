import { Graphics } from 'pixi.js'
import { TerrainType, RoomTerrain } from 'screeps-connectivity'
import { TILE_SIZE } from './RoomRenderer.js'
import { TERRAIN_PLAIN, TERRAIN_WALL, TERRAIN_SWAMP, TERRAIN_ROAD, TERRAIN_BORDER } from './colors.js'

const TERRAIN_COLORS: Record<TerrainType, number> = {
  [TerrainType.Plain]: TERRAIN_PLAIN,
  [TerrainType.Wall]:  TERRAIN_WALL,
  [TerrainType.Swamp]: TERRAIN_SWAMP,
}

function drawTerrainLayer(g: Graphics, terrain: RoomTerrain, targetType: TerrainType) {
  const color = TERRAIN_COLORS[targetType]
  const T = TILE_SIZE
  const R = T / 2

  for (let y = 0; y < 50; y++) {
    for (let x = 0; x < 50; x++) {
      const center = terrain.get(x, y) === targetType
      const top = y > 0 && terrain.get(x, y - 1) === targetType
      const bottom = y < 49 && terrain.get(x, y + 1) === targetType
      const left = x > 0 && terrain.get(x - 1, y) === targetType
      const right = x < 49 && terrain.get(x + 1, y) === targetType

      const cx = x * T + R
      const cy = y * T + R

      // Top-Left Quadrant
      if (center) {
        if (!top && !left) {
          g.moveTo(cx, y * T)
          g.arc(cx, cy, R, -Math.PI / 2, Math.PI, true)
          g.lineTo(cx, cy)
          g.fill(color)
        } else {
          g.rect(x * T, y * T, R, R)
          g.fill(color)
        }
      } else {
        if (top && left) {
          g.moveTo(cx, y * T)
          g.lineTo(x * T, y * T)
          g.lineTo(x * T, cy)
          g.arc(cx, cy, R, Math.PI, -Math.PI / 2, false)
          g.fill(color)
        }
      }

      // Top-Right Quadrant
      if (center) {
        if (!top && !right) {
          g.moveTo(cx, y * T)
          g.arc(cx, cy, R, -Math.PI / 2, 0, false)
          g.lineTo(cx, cy)
          g.fill(color)
        } else {
          g.rect(cx, y * T, R, R)
          g.fill(color)
        }
      } else {
        if (top && right) {
          g.moveTo(cx, y * T)
          g.lineTo(x * T + T, y * T)
          g.lineTo(x * T + T, cy)
          g.arc(cx, cy, R, 0, -Math.PI / 2, true)
          g.fill(color)
        }
      }

      // Bottom-Left Quadrant
      if (center) {
        if (!bottom && !left) {
          g.moveTo(x * T, cy)
          g.arc(cx, cy, R, Math.PI, Math.PI / 2, true)
          g.lineTo(cx, cy)
          g.fill(color)
        } else {
          g.rect(x * T, cy, R, R)
          g.fill(color)
        }
      } else {
        if (bottom && left) {
          g.moveTo(x * T, cy)
          g.lineTo(x * T, y * T + T)
          g.lineTo(cx, y * T + T)
          g.arc(cx, cy, R, Math.PI / 2, Math.PI, false)
          g.fill(color)
        }
      }

      // Bottom-Right Quadrant
      if (center) {
        if (!bottom && !right) {
          g.moveTo(cx, y * T + T)
          g.arc(cx, cy, R, Math.PI / 2, 0, true)
          g.lineTo(cx, cy)
          g.fill(color)
        } else {
          g.rect(cx, cy, R, R)
          g.fill(color)
        }
      } else {
        if (bottom && right) {
          g.moveTo(cx, y * T + T)
          g.lineTo(x * T + T, y * T + T)
          g.lineTo(x * T + T, cy)
          g.arc(cx, cy, R, 0, Math.PI / 2, false)
          g.fill(color)
        }
      }
    }
  }
}

function drawExits(g: Graphics, terrain: RoomTerrain) {
  const exitColor = TERRAIN_ROAD
  const T = TILE_SIZE

  const drawArrow = (x: number, y: number, dir: 'up' | 'down' | 'left' | 'right') => {
    const cx = x * T + T / 2
    const cy = y * T + T / 2
    const size = T * 0.3 // Arrow size

    g.moveTo(cx, cy) // start point
    
    if (dir === 'up') {
      g.moveTo(cx, cy - size)
      g.lineTo(cx + size, cy + size)
      g.lineTo(cx - size, cy + size)
    } else if (dir === 'down') {
      g.moveTo(cx, cy + size)
      g.lineTo(cx + size, cy - size)
      g.lineTo(cx - size, cy - size)
    } else if (dir === 'left') {
      g.moveTo(cx - size, cy)
      g.lineTo(cx + size, cy - size)
      g.lineTo(cx + size, cy + size)
    } else if (dir === 'right') {
      g.moveTo(cx + size, cy)
      g.lineTo(cx - size, cy - size)
      g.lineTo(cx - size, cy + size)
    }
    
    g.fill(exitColor)
  }

  for (let x = 0; x < 50; x++) {
    if (terrain.get(x, 0) !== TerrainType.Wall) drawArrow(x, 0, 'up')
    if (terrain.get(x, 49) !== TerrainType.Wall) drawArrow(x, 49, 'down')
  }
  for (let y = 0; y < 50; y++) {
    if (terrain.get(0, y) !== TerrainType.Wall) drawArrow(0, y, 'left')
    if (terrain.get(49, y) !== TerrainType.Wall) drawArrow(49, y, 'right')
  }
}

export function createTerrainLayer(terrain: RoomTerrain): Graphics {
  const g = new Graphics()

  // Base Plain Layer
  g.rect(0, 0, 50 * TILE_SIZE, 50 * TILE_SIZE)
  g.fill(TERRAIN_COLORS[TerrainType.Plain])

  // Draw Swamps and Walls with rounded corners
  drawTerrainLayer(g, terrain, TerrainType.Swamp)
  drawTerrainLayer(g, terrain, TerrainType.Wall)

  // Draw exits
  drawExits(g, terrain)

  // Room border
  g.rect(0, 0, 50 * TILE_SIZE, 50 * TILE_SIZE)
  g.stroke({ width: 1, color: TERRAIN_BORDER })

  return g
}
