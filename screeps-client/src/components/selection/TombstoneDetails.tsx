import { Show } from 'solid-js'
import { gameTime } from '~/stores/clientStore.js'
import { roomUsers } from '~/stores/roomDataStore.js'
import { UserLink } from '~/components/UserLink.js'
import type { SelectedObject } from '~/stores/selectionStore.js'
import { StoreDetails } from './StoreDetails.js'
import { BodyParts } from './BodyParts.js'
import { kvCell, kvGrid } from './shared.js'

export function TombstoneDetails(props: { item: SelectedObject }) {
  const raw = () => props.item.raw as Record<string, unknown>

  const decayCountdown = () => {
    const dt = raw().decayTime
    if (typeof dt !== 'number') return null
    const gt = gameTime()
    return gt !== null ? Math.max(0, dt - gt) : dt
  }

  const deathAge = () => {
    const dt = raw().deathTime
    if (typeof dt !== 'number') return null
    const gt = gameTime()
    return gt !== null ? Math.max(0, gt - dt) : null
  }

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

  const creepName = () => typeof raw().creepName === 'string' ? (raw().creepName as string) : null
  const creepTicksToLive = () => typeof raw().creepTicksToLive === 'number' ? (raw().creepTicksToLive as number) : null
  const body = () => ((raw().creepBody as string[] | undefined) ?? []).map(type => ({ type }))
  const store = () => raw().store as Record<string, number> | undefined

  return (
    <div>
      <div style={kvGrid}>
        <Show when={creepName()}>
          <>
            <div style={kvCell(true)}>Creep</div>
            <div style={kvCell()}>{creepName()}</div>
          </>
        </Show>

        <Show when={ownerName()}>
          <>
            <div style={kvCell(true)}>Owner</div>
            <div style={kvCell()}><UserLink username={ownerUsername()} fallback={ownerName()} /></div>
          </>
        </Show>

        <Show when={creepTicksToLive() !== null}>
          <>
            <div style={kvCell(true)}>TTL at death</div>
            <div style={{ ...kvCell(), 'font-variant-numeric': 'tabular-nums' }}>{creepTicksToLive()}</div>
          </>
        </Show>

        <Show when={decayCountdown() !== null}>
          <>
            <div style={kvCell(true)}>Decay in</div>
            <div style={{ ...kvCell(), 'font-variant-numeric': 'tabular-nums' }}>{decayCountdown()}</div>
          </>
        </Show>

        <Show when={deathAge() !== null}>
          <>
            <div style={kvCell(true)}>Died</div>
            <div style={{ ...kvCell(), 'font-variant-numeric': 'tabular-nums' }}>{deathAge()} ticks ago</div>
          </>
        </Show>
      </div>

      <StoreDetails store={store()} />

      <BodyParts body={body()} />
    </div>
  )
}
