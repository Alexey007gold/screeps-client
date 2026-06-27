// Power-creep game data (clean-room: numeric constants and effect facts extracted
// from the rendered official client, expressed in our own structures/wording).
// The screeps engine PWR_* ids and POWER_INFO drive the create/upgrade UI.
//
// Only the `operator` class is implemented in-game; `commander` and `executor`
// are "under development" (flavor text only, no powers).
import {
  Zap, Rocket, Crosshair, Database, FlaskConical, BatteryCharging, Eye,
  ArrowLeftRight, Ban, ZapOff, CircleSlash, Shield, ShieldCheck, Factory,
  Sun, Gem, Atom, PackageX, TrendingUp,
} from 'lucide-solid'
import type { Component } from 'solid-js'
import type { ApiPowerCreep } from 'screeps-connectivity'
import { gplLevel } from '~/utils/levels.js'

export const POWER_CREEP_CLASSES = ['operator', 'commander', 'executor'] as const
export type PowerCreepClass = (typeof POWER_CREEP_CLASSES)[number]

export const POWER_CREEP_MAX_LEVEL = 25
export const POWER_LEVELS = [1, 2, 3, 4, 5] as const

export interface PowerClassInfo {
  name: PowerCreepClass
  label: string
  description: string
  underDevelopment: boolean
}

export const POWER_CLASS_INFO: Record<PowerCreepClass, PowerClassInfo> = {
  operator: {
    name: 'operator',
    label: 'Operator',
    description:
      'A creep working mainly in the rear, at your base, though it can be used as a saboteur in offensive operations.',
    underDevelopment: false,
  },
  commander: {
    name: 'commander',
    label: 'Commander',
    description:
      "This power creep is not very useful on its own, but it's a team player. It influences and affects regular creeps, both friendly and hostile.",
    underDevelopment: true,
  },
  executor: {
    name: 'executor',
    label: 'Executor',
    description:
      "This creep class prefers working alone. Due to its skills, it's a very effective performer in your economy or as a war machine when defending or attacking.",
    underDevelopment: true,
  },
}

// Canonical screeps PWR_* ids — the keys of ApiPowerCreep.powers.
export const PWR = {
  GENERATE_OPS: 1,
  OPERATE_SPAWN: 2,
  OPERATE_TOWER: 3,
  OPERATE_STORAGE: 4,
  OPERATE_LAB: 5,
  OPERATE_EXTENSION: 6,
  OPERATE_OBSERVER: 7,
  OPERATE_TERMINAL: 8,
  DISRUPT_SPAWN: 9,
  DISRUPT_TOWER: 10,
  DISRUPT_SOURCE: 11,
  SHIELD: 12,
  REGEN_SOURCE: 13,
  REGEN_MINERAL: 14,
  DISRUPT_TERMINAL: 15,
  OPERATE_POWER: 16,
  FORTIFY: 17,
  OPERATE_CONTROLLER: 18,
  OPERATE_FACTORY: 19,
} as const

export interface PowerDef {
  id: number
  name: string
  className: PowerCreepClass
  icon: Component<{ size?: number; color?: string }>
  /** Required creep level to take each of the 5 power levels. */
  reqLevel: [number, number, number, number, number]
  /** Per-level primary effect value, already display-formatted ('' when none). */
  values: [string, string, string, string, string]
  /** Effect sentence; `%s` is replaced by the level's value. */
  effect: string
  duration?: number
  /** Cooldown in ticks; `null` means "no cooldown". */
  cooldown?: number | null
  /** Range in squares; omit for self-targeting powers. */
  range?: number
  /** Ops consumed; an array means it varies per power level. */
  ops?: number | [number, number, number, number, number]
}

const REQ_BASE: PowerDef['reqLevel'] = [0, 2, 7, 14, 22]
const REQ_10: PowerDef['reqLevel'] = [10, 11, 12, 14, 22]
const REQ_20: PowerDef['reqLevel'] = [20, 21, 22, 23, 24]
const V5 = (a: string, b: string, c: string, d: string, e: string): PowerDef['values'] => [a, b, c, d, e]

// Ordered as the vanilla create page lists them (operator kit).
export const POWER_DEFS: PowerDef[] = [
  { id: PWR.GENERATE_OPS, name: 'GENERATE_OPS', className: 'operator', icon: Zap, reqLevel: REQ_BASE,
    values: V5('1', '2', '4', '6', '8'), effect: 'Generate %s ops resource units.', cooldown: 50 },
  { id: PWR.OPERATE_SPAWN, name: 'OPERATE_SPAWN', className: 'operator', icon: Rocket, reqLevel: REQ_BASE,
    values: V5('10%', '30%', '50%', '65%', '80%'), effect: 'Reduce spawn time by %s.', duration: 1000, cooldown: 300, range: 3, ops: 100 },
  { id: PWR.OPERATE_TOWER, name: 'OPERATE_TOWER', className: 'operator', icon: Crosshair, reqLevel: REQ_BASE,
    values: V5('10%', '20%', '30%', '40%', '50%'), effect: 'Increase damage, repair and heal amount by %s.', duration: 100, cooldown: 10, range: 3, ops: 10 },
  { id: PWR.OPERATE_STORAGE, name: 'OPERATE_STORAGE', className: 'operator', icon: Database, reqLevel: REQ_BASE,
    values: V5('500K', '1M', '2M', '4M', '7M'), effect: 'Increase capacity by %s units.', duration: 1000, cooldown: 800, range: 3, ops: 100 },
  { id: PWR.OPERATE_LAB, name: 'OPERATE_LAB', className: 'operator', icon: FlaskConical, reqLevel: REQ_BASE,
    values: V5('2', '4', '6', '8', '10'), effect: 'Increase reaction amount by %s units.', duration: 1000, cooldown: 50, range: 3, ops: 10 },
  { id: PWR.OPERATE_EXTENSION, name: 'OPERATE_EXTENSION', className: 'operator', icon: BatteryCharging, reqLevel: REQ_BASE,
    values: V5('20%', '40%', '60%', '80%', '100%'), effect: 'Instantly fill %s of all extensions in the room using energy from the target structure.', cooldown: 50, range: 3, ops: 2 },
  { id: PWR.OPERATE_OBSERVER, name: 'OPERATE_OBSERVER', className: 'operator', icon: Eye, reqLevel: REQ_BASE,
    values: V5('200', '400', '600', '800', '1000'), effect: 'Grant unlimited range. Effect duration %s ticks.', cooldown: 400, range: 3, ops: 10 },
  { id: PWR.OPERATE_TERMINAL, name: 'OPERATE_TERMINAL', className: 'operator', icon: ArrowLeftRight, reqLevel: REQ_BASE,
    values: V5('10%', '20%', '30%', '40%', '50%'), effect: 'Decrease transfer energy cost and cooldown by %s.', duration: 1000, cooldown: 500, range: 3, ops: 100 },
  { id: PWR.DISRUPT_SPAWN, name: 'DISRUPT_SPAWN', className: 'operator', icon: Ban, reqLevel: REQ_BASE,
    values: V5('1', '2', '3', '4', '5'), effect: 'Pause spawning process. Effect duration %s ticks.', cooldown: 5, range: 20, ops: 10 },
  { id: PWR.DISRUPT_TOWER, name: 'DISRUPT_TOWER', className: 'operator', icon: ZapOff, reqLevel: REQ_BASE,
    values: V5('10%', '20%', '30%', '40%', '50%'), effect: 'Reduce effectiveness by %s.', duration: 5, cooldown: null, range: 50, ops: 10 },
  { id: PWR.DISRUPT_SOURCE, name: 'DISRUPT_SOURCE', className: 'operator', icon: CircleSlash, reqLevel: REQ_BASE,
    values: V5('100', '200', '300', '400', '500'), effect: 'Pause energy regeneration. Effect duration %s ticks.', cooldown: 100, range: 3, ops: 100 },
  { id: PWR.SHIELD, name: 'SHIELD', className: 'operator', icon: Shield, reqLevel: REQ_BASE,
    values: V5('5K', '10K', '15K', '20K', '25K'), effect: 'Create a temporary non-repairable rampart on the same square with %s hits. Cannot be used on top of another rampart.', duration: 50, cooldown: 20 },
  { id: PWR.FORTIFY, name: 'FORTIFY', className: 'operator', icon: ShieldCheck, reqLevel: REQ_BASE,
    values: V5('1', '2', '3', '4', '5'), effect: 'Make a wall or rampart tile invulnerable to all creep attacks and powers. Effect duration %s ticks.', cooldown: 5, range: 3, ops: 5 },
  { id: PWR.OPERATE_FACTORY, name: 'OPERATE_FACTORY', className: 'operator', icon: Factory, reqLevel: REQ_BASE,
    values: V5('1', '2', '3', '4', '5'), effect: 'Set the factory level to %s. Permanent and cannot be undone; re-apply to renew the effect.', duration: 1000, cooldown: 800, range: 3, ops: 100 },
  { id: PWR.REGEN_SOURCE, name: 'REGEN_SOURCE', className: 'operator', icon: Sun, reqLevel: REQ_10,
    values: V5('50', '100', '150', '200', '250'), effect: 'Regenerate %s energy units in a source every 15 ticks.', duration: 300, cooldown: 100, range: 3 },
  { id: PWR.REGEN_MINERAL, name: 'REGEN_MINERAL', className: 'operator', icon: Gem, reqLevel: REQ_10,
    values: V5('2', '4', '6', '8', '10'), effect: 'Regenerate %s mineral units in a deposit every 10 ticks.', duration: 100, cooldown: 100, range: 3 },
  { id: PWR.OPERATE_POWER, name: 'OPERATE_POWER', className: 'operator', icon: Atom, reqLevel: REQ_10,
    values: V5('1', '2', '3', '4', '5'), effect: 'Increase power processing speed of a Power Spawn by %s units per tick.', duration: 1000, cooldown: 800, range: 3, ops: 200 },
  { id: PWR.DISRUPT_TERMINAL, name: 'DISRUPT_TERMINAL', className: 'operator', icon: PackageX, reqLevel: REQ_20,
    values: V5('', '', '', '', ''), effect: 'Block withdrawing resources from the terminal.', duration: 10, cooldown: 8, range: 50, ops: [50, 40, 30, 20, 10] },
  { id: PWR.OPERATE_CONTROLLER, name: 'OPERATE_CONTROLLER', className: 'operator', icon: TrendingUp, reqLevel: REQ_20,
    values: V5('10', '20', '30', '40', '50'), effect: 'Increase the max energy that can upgrade a Level 8 Controller each tick by %s units.', duration: 1000, cooldown: 800, range: 3, ops: 200 },
]

export const POWER_DEFS_BY_ID: Record<number, PowerDef> = Object.fromEntries(POWER_DEFS.map((d) => [d.id, d]))

export function powersForClass(className: PowerCreepClass): PowerDef[] {
  return POWER_DEFS.filter((d) => d.className === className)
}

/** Effect sentence for a given power level (1-5), value substituted. */
export function powerEffect(def: PowerDef, level: number): string {
  const v = def.values[Math.max(0, Math.min(4, level - 1))]
  return def.effect.replace('%s', v)
}

/** Compact stat line ("ops 100 · cd 300 · rng 3") for a given power level. */
export function powerMeta(def: PowerDef, level: number): string {
  const parts: string[] = []
  const ops = Array.isArray(def.ops) ? def.ops[Math.max(0, Math.min(4, level - 1))] : def.ops
  if (ops != null) parts.push(`ops ${ops}`)
  if (def.duration != null) parts.push(`dur ${def.duration}`)
  if (def.cooldown === null) parts.push('no cooldown')
  else if (def.cooldown != null) parts.push(`cd ${def.cooldown}`)
  if (def.range != null) parts.push(`rng ${def.range}`)
  return parts.join(' · ')
}

/** Total account power levels consumed by one creep (creation + each power level). */
export function creepPowerCost(creep: Pick<ApiPowerCreep, 'level'>): number {
  return creep.level + 1
}

/** Unspent account power levels: GPL minus what every owned creep consumes. */
export function freePowerLevels(userPower: number | undefined, creeps: ApiPowerCreep[]): number {
  return gplLevel(userPower ?? 0) - creeps.reduce((sum, c) => sum + creepPowerCost(c), 0)
}
