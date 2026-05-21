import { createSignal, createEffect, onCleanup, Show } from 'solid-js'
import { connect, status, error } from '~/stores/clientStore.js'
import { isEmbedded, embeddedServerUrl } from '~/utils/embedded.js'
import { fetchServerVersion, getScreepsmodAuth } from 'screeps-connectivity'
import type { ServerVersion } from 'screeps-connectivity'

function useServerInfo(url: () => string) {
  const [serverVersion, setServerVersion] = createSignal<ServerVersion | null>(null)
  const [serverError, setServerError] = createSignal<string | null>(null)

  createEffect(() => {
    const rawUrl = url()
    setServerVersion(null)
    setServerError(null)

    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const v = await fetchServerVersion(rawUrl)
        if (!cancelled) { setServerVersion(v); setServerError(null) }
      } catch {
        if (!cancelled) { setServerError('Could not reach server'); setServerVersion(null) }
      }
    }, 400)

    onCleanup(() => { cancelled = true; clearTimeout(timer) })
  })

  return { serverVersion, serverError }
}

export function LoginForm() {
  const embedded = isEmbedded()
  const [authType, setAuthType] = createSignal<'password' | 'token'>('password')
  const [url, setUrl] = createSignal(embedded ? embeddedServerUrl() : 'http://localhost:21025')
  const [email, setEmail] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [token, setToken] = createSignal('')
  const [serverPassword, setServerPassword] = createSignal('')

  const { serverVersion, serverError } = useServerInfo(url)

  const welcomeText = () => serverVersion()?.serverData?.welcomeText ?? null
  const mods = () => {
    const features = serverVersion()?.serverData?.features ?? []
    return features.filter(f => f.name !== 'auth' && typeof f.version !== 'undefined')
  }
  const authMod = () => {
    const v = serverVersion()
    return v ? getScreepsmodAuth(v) : null
  }
  const hasSteam = () => authMod()?.authTypes?.includes('steam') ?? true

  const handleSteamLogin = () => {
    const serverUrl = url().replace(/\/$/, '')
    const popup = window.open(`${serverUrl}/api/auth/steam`, 'screeps-steam-auth', 'width=800,height=600,left=200,top=100')

    const onMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as { token?: string }
        if (data.token) {
          cleanup()
          connect({ url: serverUrl, auth: 'token', token: data.token, serverPassword: serverPassword() || undefined, storage: null })
        }
      } catch { /* non-JSON messages from other sources */ }
    }

    const checkClosed = setInterval(() => { if (popup?.closed) cleanup() }, 500)

    const cleanup = () => {
      clearInterval(checkClosed)
      window.removeEventListener('message', onMessage)
    }

    window.addEventListener('message', onMessage)
    onCleanup(cleanup)
  }

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    await connect({
      url: url(),
      auth: authType(),
      email: email() || undefined,
      password: password() || undefined,
      token: token() || undefined,
      serverPassword: serverPassword() || undefined,
      storage: null,
    })
  }

  const handleGuestConnect = async (e: MouseEvent) => {
    e.preventDefault()
    await connect({
      url: url(),
      auth: 'guest',
      serverPassword: serverPassword() || undefined,
      storage: null,
    })
  }

  const isConnecting = () => status() === 'connecting'

  const inputStyle = {
    padding: '8px 12px',
    'border-radius': '6px',
    border: '1px solid #30363d',
    background: '#0d1117',
    color: '#c9d1d9',
  }

  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        'justify-content': 'center',
        gap: '16px',
        width: '100%',
        height: '100%',
        overflow: 'auto',
        padding: '24px 0',
        'box-sizing': 'border-box',
      }}
    >
      <Show when={welcomeText()}>
        <div
          style={{
            width: '360px',
            padding: '16px 20px',
            'border-radius': '8px',
            background: '#161b22',
            border: '1px solid #30363d',
            color: '#c9d1d9',
            'font-size': '13px',
            'line-height': '1.6',
          }}
          // eslint-disable-next-line solid/no-innerhtml
          innerHTML={welcomeText()!}
        />
      </Show>

      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          'flex-direction': 'column',
          gap: '16px',
          width: '360px',
          padding: '32px',
          'border-radius': '8px',
          background: '#161b22',
          border: '1px solid #30363d',
        }}
      >
        <h2 style={{ margin: 0, 'font-size': '20px' }}>Connect to Screeps</h2>

        <Show when={!embedded}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setAuthType('password')}
              style={{
                flex: 1,
                padding: '8px',
                'border-radius': '6px',
                border: '1px solid #30363d',
                background: authType() === 'password' ? '#238636' : 'transparent',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Password
            </button>
            <button
              type="button"
              onClick={() => setAuthType('token')}
              style={{
                flex: 1,
                padding: '8px',
                'border-radius': '6px',
                border: '1px solid #30363d',
                background: authType() === 'token' ? '#238636' : 'transparent',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Token
            </button>
          </div>
        </Show>

        <Show when={!embedded}>
          <label style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
            <span style={{ 'font-size': '12px', color: '#8b949e' }}>Server URL</span>
            <input
              type="url"
              name="url"
              autocomplete="url"
              inputmode="url"
              value={url()}
              onInput={(e) => setUrl(e.currentTarget.value)}
              style={inputStyle}
            />
          </label>
          <Show when={serverError()}>
            <div style={{ color: '#8b949e', 'font-size': '12px', 'margin-top': '-8px' }}>{serverError()}</div>
          </Show>
        </Show>

        {authType() === 'password' ? (
          <>
            <label style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
              <span style={{ 'font-size': '12px', color: '#8b949e' }}>Email or Username</span>
              <input
                type="text"
                id="username"
                name="username"
                autocomplete="username"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                style={inputStyle}
              />
            </label>
            <label style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
              <span style={{ 'font-size': '12px', color: '#8b949e' }}>Password</span>
              <input
                type="password"
                id="password"
                name="password"
                autocomplete="current-password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                style={inputStyle}
              />
            </label>
          </>
        ) : (
          <label style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
            <span style={{ 'font-size': '12px', color: '#8b949e' }}>Auth Token</span>
            <input
              type="password"
              name="token"
              autocomplete="off"
              value={token()}
              onInput={(e) => setToken(e.currentTarget.value)}
              style={inputStyle}
            />
          </label>
        )}

        <label style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
          <span style={{ 'font-size': '12px', color: '#8b949e' }}>Server Password <span style={{ color: '#484f58' }}>(optional)</span></span>
          <input
            type="password"
            name="server-password"
            autocomplete="off"
            data-1p-ignore
            data-lpignore="true"
            value={serverPassword()}
            onInput={(e) => setServerPassword(e.currentTarget.value)}
            placeholder="Leave empty if not required"
            style={inputStyle}
          />
        </label>

        {error() && (
          <div style={{ color: '#f85149', 'font-size': '13px' }}>{error()}</div>
        )}

        <button
          type="submit"
          disabled={isConnecting()}
          style={{
            padding: '10px',
            'border-radius': '6px',
            border: 'none',
            background: '#238636',
            color: '#fff',
            'font-weight': 600,
            cursor: isConnecting() ? 'not-allowed' : 'pointer',
            opacity: isConnecting() ? 0.6 : 1,
          }}
        >
          {isConnecting() ? 'Connecting…' : 'Connect'}
        </button>

        <Show when={hasSteam()}>
          <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', color: '#484f58', 'font-size': '12px' }}>
            <div style={{ flex: 1, height: '1px', background: '#30363d' }} />
            or
            <div style={{ flex: 1, height: '1px', background: '#30363d' }} />
          </div>

          <button
            type="button"
            disabled={isConnecting()}
            onClick={handleSteamLogin}
            style={{
              padding: '10px',
              'border-radius': '6px',
              border: 'none',
              background: '#1b2838',
              color: '#c7d5e0',
              'font-weight': 600,
              cursor: isConnecting() ? 'not-allowed' : 'pointer',
              opacity: isConnecting() ? 0.6 : 1,
            }}
          >
            Login with Steam
          </button>
        </Show>

        <Show when={!embedded}>
          <button
            type="button"
            disabled={isConnecting()}
            onClick={handleGuestConnect}
            style={{
              padding: '8px',
              'border-radius': '6px',
              border: '1px solid #30363d',
              background: 'transparent',
              color: '#8b949e',
              'font-size': '12px',
              cursor: isConnecting() ? 'not-allowed' : 'pointer',
              opacity: isConnecting() ? 0.6 : 1,
            }}
            onMouseEnter={(e) => { if (!isConnecting()) e.currentTarget.style.borderColor = '#8b949e' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#30363d' }}
          >
            Connect as Guest (read-only)
          </button>
        </Show>
      </form>

      <Show when={mods().length > 0}>
        <div
          style={{
            width: '360px',
            padding: '12px 20px',
            'border-radius': '8px',
            background: '#161b22',
            border: '1px solid #30363d',
          }}
        >
          <div style={{ 'font-size': '11px', color: '#484f58', 'margin-bottom': '8px', 'text-transform': 'uppercase', 'letter-spacing': '0.05em' }}>
            Server Mods
          </div>
          <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '6px' }}>
            {mods().map(f => (
              <span
                style={{
                  'font-size': '11px',
                  padding: '2px 8px',
                  'border-radius': '12px',
                  background: '#21262d',
                  border: '1px solid #30363d',
                  color: '#8b949e',
                  'font-family': 'monospace',
                }}
              >
                {f.name}{f.version ? ` ${f.version}` : ''}
              </span>
            ))}
          </div>
        </div>
      </Show>
    </div>
  )
}
