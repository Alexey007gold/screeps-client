import { Show, createMemo } from 'solid-js'
import type { RoomObject } from 'screeps-connectivity'
import { gameTime } from '~/stores/clientStore.js'
import { selection } from '~/stores/selectionStore.js'
import { spawnTiming } from '~/renderer/objects/spawn.js'
import { kvCell } from './shared.js'

const SPAWNER_TYPES = new Set(['spawn', 'invaderCore'])

const DIRECTION_ARROWS: Record<number, string> = {
  1: '⬆',
  2: '⬈',
  3: '➡',
  4: '⬊',
  5: '⬇',
  6: '⬋',
  7: '⬅',
  8: '⬉',
}

function spawningName(raw: Record<string, unknown>): unknown {
  const s = raw.spawning as { name?: unknown } | null | undefined
  return s && typeof s === 'object' ? s.name : undefined
}

export function SpawningDetails(props: { creep: Record<string, unknown> }) {
  const spawner = createMemo(() => {
    const creep = props.creep
    if (creep.spawning !== true || typeof creep.name !== 'string') return null
    const match = selection().find(item => {
      const raw = item.raw as Record<string, unknown>
      return SPAWNER_TYPES.has(item.type)
        && raw.x === creep.x && raw.y === creep.y && raw.room === creep.room
        && spawningName(raw) === creep.name
    })
    return match ? (match.raw as Record<string, unknown>) : null
  })

  const timing = () => {
    const raw = spawner()
    const gt = gameTime()
    if (!raw || gt === null) return null
    const t = spawnTiming(raw as unknown as RoomObject, gt)
    if (!t) return null
    return { remaining: Math.max(0, t.endTime - gt), total: t.needTime }
  }

  const directions = () => {
    const s = spawner()?.spawning as { directions?: unknown } | null | undefined
    if (!s || typeof s !== 'object' || !Array.isArray(s.directions)) return null
    const arrows = s.directions.map(d => DIRECTION_ARROWS[d as number]).filter(a => a !== undefined)
    return arrows.length > 0 ? arrows.join(' ') : null
  }

  return (
    <>
      <Show when={timing()}>
        {(t) => (
          <>
            <div style={kvCell(true)}>Time remaining</div>
            <div style={{ ...kvCell(), 'font-variant-numeric': 'tabular-nums' }}>{t().remaining} / {t().total}</div>
          </>
        )}
      </Show>

      <Show when={directions()}>
        {(arrows) => (
          <>
            <div style={kvCell(true)}>Directions</div>
            <div style={kvCell()}>{arrows()}</div>
          </>
        )}
      </Show>
    </>
  )
}
