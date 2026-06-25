// Single source of truth for minimap rendering — the per-room dots/terrain
// palette and geometry shared by the world map (PixiJS, MapRenderer.ts), the
// baked terrain worker (terrain.worker.ts), and the Overview room-preview tiles
// (RoomPreviewTile.tsx, plain 2D canvas). Keep every minimap magic number here
// so the three renderers stay pixel-identical.
import { ENERGY_FILL, OBJ_CYAN, OBJ_ORANGE, OBJ_GREEN, OBJ_FOREIGN, TERRAIN_ROAD } from './colors.js'

// Geometry: 3px per game cell → 150px per 50×50 room.
export const MINIMAP_TILE = 3
export const MINIMAP_ROOM = MINIMAP_TILE * 50

// Terrain fill (matches the baked terrain worker's hues). MINIMAP_PLAIN is
// deliberately its own value, NOT colors.TERRAIN_PLAIN — the minimap uses a
// darker, desaturated plain than the in-room terrain. Keep them independent.
export const MINIMAP_PLAIN = 0x2d333b
export const MINIMAP_WALL = 0x0d1117
export const MINIMAP_SWAMP = 0x3d5a3d

// map2 overlay colours.
export const MINIMAP_ROAD = TERRAIN_ROAD
export const MINIMAP_WALLS_OWN = 0x447744
export const MINIMAP_WALLS_FOREIGN = 0x882222
export const MINIMAP_USER_OWN = OBJ_GREEN
export const MINIMAP_USER_FOREIGN = OBJ_FOREIGN

// map2 point features drawn as dots, in render order. Radii are in minimap px.
export interface Map2DotFeature {
  key: string
  color: number
  radius: number
}
export const MAP2_DOT_FEATURES: Map2DotFeature[] = [
  { key: 's', color: ENERGY_FILL, radius: 2.5 },  // sources
  { key: 'c', color: 0xffffff, radius: 2.0 },     // controllers
  { key: 'm', color: OBJ_CYAN, radius: 2.0 },     // minerals
  { key: 'k', color: OBJ_ORANGE, radius: 2.0 },   // source keeper lairs
  { key: 'pb', color: 0xff2222, radius: 2.5 },    // power banks
  { key: 'd', color: 0xffffff, radius: 2.5 },     // deposits
]

// Reserved map2 keys with fixed meaning; any other key is a userId (objects).
// Note 'p' (portals) is reserved here so it's excluded from the userId loop, but
// no minimap renderer draws portals — they're intentionally omitted.
export const MAP2_FIXED_KEYS = new Set(['w', 'r', 'pb', 'p', 's', 'c', 'm', 'k', 'd'])

// 0xrrggbb → '#rrggbb' for 2D-canvas fillStyle.
export function toCss(n: number): string {
  return '#' + n.toString(16).padStart(6, '0')
}
