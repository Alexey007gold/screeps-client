// ── Backgrounds ────────────────────────────────────────────────────────────
export const BG_DEEP    = 0x0d1117  // wall tiles, creep body center
export const BG_DARK    = 0x161b22  // creep inner ring, extension bg
export const BG_MEDIUM  = 0x1c2128  // creep ring: empty body-part slots
export const BG_SURFACE = 0x34343B  // terrain plain

// ── Terrain ────────────────────────────────────────────────────────────────
export const TERRAIN_PLAIN  = BG_SURFACE
export const TERRAIN_WALL   = BG_DEEP
export const TERRAIN_SWAMP  = 0x334933
export const TERRAIN_ROAD   = 0x6B6969 // also used for room exits
export const TERRAIN_BORDER = 0x30363d

// ── Body parts ─────────────────────────────────────────────────────────────
export const BP_TOUGH         = 0x4c4c4c
export const BP_MOVE          = 0xa9b7c6
export const BP_WORK          = 0xffe56d
export const BP_CARRY         = 0x777777
export const BP_ATTACK        = 0xf93842
export const BP_RANGED_ATTACK = 0x5d80b2
export const BP_HEAL          = 0x65fd62
export const BP_CLAIM         = 0xb99cfb
export const BODY_PART_COLORS: Record<string, number> = {
  tough:         BP_TOUGH,
  move:          BP_MOVE,
  work:          BP_WORK,
  carry:         BP_CARRY,
  attack:        BP_ATTACK,
  ranged_attack: BP_RANGED_ATTACK,
  heal:          BP_HEAL,
  claim:         BP_CLAIM,
}

// ── Structures & objects ───────────────────────────────────────────────────
export const OBJ_BLUE   = 0x58a6ff  // spawn, rampart, controller
export const OBJ_CYAN   = 0x79c0ff  // extension, observer, mineral
export const OBJ_GREEN  = 0x3fb950  // tower
export const OBJ_GREY   = 0x8b949e  // container, extractor, factory
export const OBJ_GOLD   = 0xd29922  // storage, terminal, source, deposit
export const OBJ_PURPLE = 0xa371f7  // link, portal
export const OBJ_PINK   = 0xf778ba  // lab
export const OBJ_RED    = 0xf85149  // nuker, invaderCore
export const OBJ_ORANGE = 0xf0883e  // creep fallback, powerSpawn, powerBank
export const OBJ_WALL   = 0x21262d
export const OBJ_ROAD   = TERRAIN_ROAD
export const OBJ_DEFAULT = 0xc9d1d9  // unknown type fallback

export const OBJECT_COLORS: Record<string, number> = {
  creep:       OBJ_ORANGE,
  spawn:       OBJ_BLUE,
  extension:   OBJ_CYAN,
  tower:       OBJ_GREEN,
  container:   OBJ_GREY,
  storage:     OBJ_GOLD,
  link:        OBJ_PURPLE,
  rampart:     OBJ_BLUE,
  road:        OBJ_ROAD,
  wall:        OBJ_WALL,
  extractor:   OBJ_GREY,
  lab:         OBJ_PINK,
  terminal:    OBJ_GOLD,
  observer:    OBJ_CYAN,
  powerSpawn:  OBJ_ORANGE,
  nuker:       OBJ_RED,
  factory:     OBJ_GREY,
  invaderCore: OBJ_RED,
  source:      OBJ_GOLD,
  mineral:     OBJ_CYAN,
  deposit:     OBJ_GOLD,
  controller:  OBJ_BLUE,
  powerBank:   OBJ_ORANGE,
  portal:      OBJ_PURPLE,
}

// ── Resources ──────────────────────────────────────────────────────────────
export const ENERGY_FILL = 0xffe066  // extension fill, dropped energy, harvest beam

// ── Animations ─────────────────────────────────────────────────────────────
export const ANIM_HARVEST = ENERGY_FILL
export const ANIM_UPGRADE = OBJ_CYAN

// ── Creep rendering ────────────────────────────────────────────────────────
export const CREEP_RING_DARK = BG_MEDIUM
export const CREEP_NOTCH     = 0xd0d0d0

// ── Screeps canonical structure palette ────────────────────────────────────
export const ST_DARK           = 0x181818  // structure dark background
export const ST_GRAY           = 0x555555  // structure gray fill
export const ST_LIGHT          = 0xAAAAAA  // structure light elements
export const ST_OUTLINE        = 0x8FBB93  // structure green outline
export const ST_ENERGY         = 0xFFE87B  // energy (structure displays)
export const ST_POWER          = 0xF53547  // power red
export const ST_RAMPART        = 0x434C43  // rampart fill
export const ST_RAMPART_STROKE = 0x5D735F  // rampart border
