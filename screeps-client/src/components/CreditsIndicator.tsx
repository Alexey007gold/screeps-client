import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { SubscriptionGroup } from 'screeps-connectivity'
import { client, userInfo } from '~/stores/clientStore.js'
import { fmtPrice } from '~/utils/formatNumber.js'

export function CreditsIndicator() {
  const [liveCredits, setLiveCredits] = createSignal<number | null>(null)

  const credits = (): number | null => liveCredits() ?? userInfo()?.credits ?? null

  onMount(() => {
    const c = client()
    if (!c) return

    const group = new SubscriptionGroup()
    group.add(c.stores.user.subscribe('resources'))
    group.add(c.stores.user.on('user:resources', (data) => {
      if (typeof data.credits === 'number') setLiveCredits(data.credits)
    }))

    onCleanup(() => {
      group.dispose()
    })
  })

  return (
    <Show when={credits() !== null}>
      <div style={{ display: 'flex', gap: '6px', 'align-items': 'center', padding: '6px 12px', 'font-size': '12px', color: '#8b949e' }}>
        <span style={{ 'font-weight': 600 }}>Credits:</span>
        <span style={{ color: '#c9d1d9', 'font-variant-numeric': 'tabular-nums' }}>{fmtPrice(credits())}</span>
      </div>
    </Show>
  )
}
