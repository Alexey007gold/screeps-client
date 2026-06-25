// Global Control / Power Level math, mirroring the server constants
// (GCL_POW, GCL_MULTIPLY, POWER_LEVEL_POW, POWER_LEVEL_MULTIPLY). The `gcl` and
// `power` fields on the user record are raw accumulated points; the displayed
// level and ring progress are derived here. GCL starts at level 1 (the +1),
// GPL starts at level 0.

export const GCL_POW = 2.4
export const GCL_MULTIPLY = 1_000_000
export const POWER_LEVEL_POW = 2
export const POWER_LEVEL_MULTIPLY = 1_000

export interface LevelProgress {
  level: number
  /** Points accumulated into the current level. */
  current: number
  /** Points spanning the current level (current / total = ring fill). */
  total: number
}

export function gclLevel(points: number): number {
  return Math.floor((points / GCL_MULTIPLY) ** (1 / GCL_POW)) + 1
}

export function gclProgress(points: number): LevelProgress {
  const level = gclLevel(points)
  const base = (level - 1) ** GCL_POW * GCL_MULTIPLY
  const next = level ** GCL_POW * GCL_MULTIPLY
  return { level, current: points - base, total: next - base }
}

export function gplLevel(power: number): number {
  return Math.floor((power / POWER_LEVEL_MULTIPLY) ** (1 / POWER_LEVEL_POW))
}

export function gplProgress(power: number): LevelProgress {
  const level = gplLevel(power)
  const base = level ** POWER_LEVEL_POW * POWER_LEVEL_MULTIPLY
  const next = (level + 1) ** POWER_LEVEL_POW * POWER_LEVEL_MULTIPLY
  return { level, current: power - base, total: next - base }
}
