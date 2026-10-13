import { For, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { gameTime } from '~/stores/clientStore.js'
import { roomUsers } from '~/stores/roomDataStore.js'
import { UserLink } from '~/components/UserLink.js'
import { HitsBar } from '~/components/MeterBar.js'
import { POWER_CLASS_INFO, POWER_DEFS_BY_ID, type PowerCreepClass } from '~/data/powerCreeps.js'
import type { SelectedObject } from '~/stores/selectionStore.js'
import { StoreDetails } from './StoreDetails.js'
import { kvCell, kvGrid, remainingCooldown } from './shared.js'

type PowerEntry = { level?: number; cooldownTime?: number }

export function PowerCreepDetails(props: { item: SelectedObject }) {
  const raw = () => props.item.raw as Record<string, unknown>

  const userId = () => typeof raw().user === 'string' ? (raw().user as string) : null
  const ownerUsername = () => {
    const uid = userId()
    return uid ? roomUsers()?.[uid]?.username ?? null : null
  }
  const ownerName = () => {
    const uid = userId()
    if (!uid) return null
    return ownerUsername() ?? uid
  }

  const className = () => {
    const cls = raw().className
    return typeof cls === 'string' && cls in POWER_CLASS_INFO ? POWER_CLASS_INFO[cls as PowerCreepClass].label : null
  }
  const level = () => typeof raw().level === 'number' ? (raw().level as number) : null
  const hits = () => typeof raw().hits === 'number' ? (raw().hits as number) : null
  const hitsMax = () => typeof raw().hitsMax === 'number' ? (raw().hitsMax as number) : null
  const ttl = () => {
    const age = raw().ageTime
    const gt = gameTime()
    if (typeof age === 'number' && gt !== null) return Math.max(0, age - gt)
    return null
  }
  const store = () => raw().store as Record<string, number> | undefined
  const storeCapacity = () => typeof raw().storeCapacity === 'number' ? (raw().storeCapacity as number) : null

  const powers = () => {
    const entries = (raw().powers ?? {}) as Record<string, PowerEntry>
    return Object.entries(entries)
      .map(([id, entry]) => ({
        id: Number(id),
        def: POWER_DEFS_BY_ID[Number(id)],
        level: entry?.level ?? null,
        cooldown: entry ? remainingCooldown(entry as Record<string, unknown>, gameTime()) ?? 0 : 0,
      }))
      .sort((a, b) => a.id - b.id)
  }

  return (
    <div>
      <div style={kvGrid}>
        <Show when={ownerName()}>
          <>
            <div style={kvCell(true)}>Owner</div>
            <div style={kvCell()}><UserLink username={ownerUsername()} fallback={ownerName()} /></div>
          </>
        </Show>

        <Show when={className()}>
          <>
            <div style={kvCell(true)}>Class</div>
            <div style={kvCell()}>{className()}</div>
          </>
        </Show>

        <Show when={level() !== null}>
          <>
            <div style={kvCell(true)}>Level</div>
            <div style={{ ...kvCell(), 'font-variant-numeric': 'tabular-nums' }}>{level()}</div>
          </>
        </Show>

        <Show when={hits() !== null && hitsMax() !== null}>
          <>
            <div style={kvCell(true)}>Hits</div>
            <div style={{ ...kvCell(), 'font-variant-numeric': 'tabular-nums' }}>{hits()} / {hitsMax()}</div>
          </>
        </Show>

        <Show when={ttl() !== null}>
          <>
            <div style={kvCell(true)}>Time to live</div>
            <div style={{ ...kvCell(), 'font-variant-numeric': 'tabular-nums' }}>{ttl()}</div>
          </>
        </Show>
      </div>

      <HitsBar hits={hits()} max={hitsMax()} />

      <StoreDetails store={store()} capacity={storeCapacity()} />

      <Show when={powers().length > 0}>
        <div style={{ background: '#21262d', 'border-top': '1px solid #30363d', 'font-size': '10px' }}>
          <div style={{ padding: '4px 8px', background: '#161b22', color: '#8b949e', 'font-weight': 600 }}>
            Powers ({powers().length})
          </div>
          <div style={{ display: 'grid', 'grid-template-columns': '1fr auto auto', gap: '1px', background: '#21262d' }}>
            <For each={powers()}>
              {(power) => (
                <>
                  <div style={{ ...kvCell(), display: 'flex', 'align-items': 'center', gap: '6px' }}>
                    <Show when={power.def}>
                      {(def) => <Dynamic component={def().icon} size={11} color="#8b949e" />}
                    </Show>
                    <span style={{ overflow: 'hidden', 'text-overflow': 'ellipsis' }}>
                      {power.def?.name ?? `Power ${power.id}`}
                    </span>
                  </div>
                  <div style={{ ...kvCell(true), 'font-variant-numeric': 'tabular-nums' }}>
                    {power.level !== null ? `Lv ${power.level}` : ''}
                  </div>
                  <div
                    title={power.cooldown > 0 ? `${power.cooldown} ticks of cooldown left` : 'Ready'}
                    style={{
                      ...kvCell(),
                      'font-variant-numeric': 'tabular-nums',
                      'text-align': 'right',
                      color: power.cooldown > 0 ? '#e3b341' : '#3fb950',
                    }}
                  >
                    {power.cooldown > 0 ? power.cooldown : 'ready'}
                  </div>
                </>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}
