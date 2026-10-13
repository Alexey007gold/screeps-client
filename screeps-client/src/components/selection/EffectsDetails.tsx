import { For, Show, type Component } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { Hourglass, ShieldAlert } from 'lucide-solid'
import { gameTime } from '~/stores/clientStore.js'
import { POWER_DEFS_BY_ID } from '~/data/powerCreeps.js'
import { kvCell } from './shared.js'

type RawEffect = { effect?: number; power?: number; level?: number; endTime?: number }

type IconComponent = Component<{ size?: number; color?: string }>

const NATURAL_EFFECTS: Record<number, { name: string; icon: IconComponent }> = {
  1001: { name: 'INVULNERABILITY', icon: ShieldAlert },
  1002: { name: 'COLLAPSE_TIMER', icon: Hourglass },
}

function describeEffect(id: number): { name: string; icon: IconComponent | null } {
  const def = POWER_DEFS_BY_ID[id]
  if (def) return { name: def.name, icon: def.icon }
  return NATURAL_EFFECTS[id] ?? { name: `Effect ${id}`, icon: null }
}

export function EffectsDetails(props: { raw: Record<string, unknown> }) {
  const effects = () => {
    const source = props.raw.effects
    if (!source || typeof source !== 'object') return []
    const gt = gameTime()
    return Object.values(source as Record<string, RawEffect | null>)
      .filter((e): e is RawEffect => e != null && typeof e === 'object')
      .map(e => {
        const id = e.effect ?? e.power ?? 0
        const remaining = typeof e.endTime === 'number' && gt !== null ? e.endTime - gt : null
        return { id, level: e.level ?? null, remaining, ...describeEffect(id) }
      })
      .filter(e => e.remaining === null || e.remaining > 0)
  }

  return (
    <Show when={effects().length > 0}>
      <div style={{ background: '#21262d', 'border-top': '1px solid #30363d', 'font-size': '10px' }}>
        <div style={{ padding: '4px 8px', background: '#161b22', color: '#8b949e', 'font-weight': 600 }}>
          Effects ({effects().length})
        </div>
        <div style={{ display: 'grid', 'grid-template-columns': '1fr auto auto', gap: '1px', background: '#21262d' }}>
          <For each={effects()}>
            {(effect) => (
              <>
                <div style={{ ...kvCell(), display: 'flex', 'align-items': 'center', gap: '6px' }}>
                  <Show when={effect.icon}>
                    {(icon) => <Dynamic component={icon()} size={11} color="#8b949e" />}
                  </Show>
                  <span style={{ overflow: 'hidden', 'text-overflow': 'ellipsis' }}>{effect.name}</span>
                </div>
                <div style={{ ...kvCell(true), 'font-variant-numeric': 'tabular-nums' }}>
                  {effect.level !== null ? `Lv ${effect.level}` : ''}
                </div>
                <div
                  title={effect.remaining !== null ? `${effect.remaining} ticks remaining` : undefined}
                  style={{ ...kvCell(), 'font-variant-numeric': 'tabular-nums', 'text-align': 'right', color: '#a371f7' }}
                >
                  {effect.remaining ?? ''}
                </div>
              </>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
