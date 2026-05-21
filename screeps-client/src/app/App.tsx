import { onMount } from 'solid-js'
import { client, status, tryAutoConnect, connect } from '~/stores/clientStore.js'
import { LoginForm } from '~/components/LoginForm.js'
import { Dashboard } from './Dashboard.js'
import { isEmbedded } from '~/utils/embedded.js'
import { createLogger } from '~/utils/log.js'
import { SS, getSession } from '~/utils/storage.js'

const { log } = createLogger('app')

function guestAutoConnectUrl(): string | null {
  const param = new URLSearchParams(window.location.search).get('guest')
  if (param === null) return null
  if (param.startsWith('http')) return param
  return getSession(SS.url) ?? 'https://screeps.com'
}

export function App() {
  const isConnected = () => status() === 'connected' && client() !== null

  onMount(async () => {
    if (status() === 'idle') {
      await tryAutoConnect().catch(() => {})
      if (status() !== 'connected' && !isEmbedded()) {
        const guestUrl = guestAutoConnectUrl()
        if (guestUrl) {
          log(`?guest param — auto-connecting as guest to ${guestUrl}`)
          connect({ url: guestUrl, auth: 'guest', storage: null }).catch(() => {})
        }
      }
    }
  })

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {isConnected() ? <Dashboard /> : <LoginForm />}
    </div>
  )
}
