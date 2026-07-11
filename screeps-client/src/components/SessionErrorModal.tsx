import { Show, createSignal, createEffect, onCleanup } from 'solid-js'
import { sessionError, disconnect, retryConnection } from '~/stores/clientStore.js'

const AUTO_RETRY_BASE_MS = 3_000
const AUTO_RETRY_MAX_MS = 30_000

// Shown over the Dashboard when the active session hits a fatal error (socket
// gave up reconnecting, or the server closed the connection for good). Rather
// than silently bouncing back to the login screen, this surfaces the error and
// keeps retrying in the background (retryConnection reuses the persisted token
// and never touches `status`, so the Dashboard's UI state — camera, viewed
// rooms, selection — never unmounts) until it succeeds, or the user logs out
// or reloads.
export function SessionErrorModal() {
  const [retrying, setRetrying] = createSignal(false)
  // Plain (non-reactive) scheduling state, deliberately kept out of signals —
  // performRetry()'s completion calls scheduleAutoRetry() directly, and that
  // must not race with the effect below also reacting to setRetrying(false)
  // and scheduling a second, overlapping timer.
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight = false

  const stopAutoRetry = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    attempt = 0
  }

  const performRetry = () => {
    inFlight = true
    setRetrying(true)
    retryConnection()
      .catch(() => false)
      .then((succeeded) => {
        inFlight = false
        setRetrying(false)
        if (!succeeded && sessionError()) scheduleAutoRetry()
      })
  }

  const scheduleAutoRetry = () => {
    const delay = Math.min(AUTO_RETRY_BASE_MS * 2 ** attempt, AUTO_RETRY_MAX_MS)
    attempt += 1
    timer = setTimeout(() => {
      timer = null
      if (!sessionError()) return
      performRetry()
    }, delay)
  }

  const retryNow = () => {
    if (inFlight) return
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    attempt = 0
    performRetry()
  }

  createEffect(() => {
    if (sessionError()) {
      if (timer === null && !inFlight) scheduleAutoRetry()
    } else {
      stopAutoRetry()
    }
  })

  onCleanup(stopAutoRetry)

  return (
    <Show when={sessionError()}>
      <div
        style={{
          position: 'fixed',
          inset: '0',
          background: 'rgba(0,0,0,0.65)',
          'z-index': 500,
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
        }}
      >
        <div
          style={{
            width: 'min(440px, calc(100% - 48px))',
            background: '#161b22',
            border: '1px solid #30363d',
            'border-radius': '8px',
            'box-shadow': '0 8px 24px rgba(0, 0, 0, 0.5)',
            padding: '20px',
          }}
        >
          <div style={{ 'font-size': '16px', 'font-weight': 600, color: '#f85149', 'margin-bottom': '12px' }}>
            Connection lost
          </div>
          <p style={{ 'font-size': '13px', color: '#c9d1d9', 'line-height': '1.5', margin: '0 0 18px' }}>
            {sessionError()}
          </p>
          <div style={{ display: 'flex', 'justify-content': 'flex-end', gap: '8px' }}>
            <button
              onClick={() => disconnect()}
              style={{
                padding: '7px 14px',
                'border-radius': '4px',
                border: '1px solid #30363d',
                background: '#21262d',
                color: '#c9d1d9',
                cursor: 'pointer',
                'font-size': '13px',
              }}
            >
              Logout
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '7px 14px',
                'border-radius': '4px',
                border: '1px solid #30363d',
                background: '#21262d',
                color: '#c9d1d9',
                cursor: 'pointer',
                'font-size': '13px',
              }}
            >
              Reload page
            </button>
            <button
              disabled={retrying()}
              onClick={retryNow}
              style={{
                padding: '7px 14px',
                'border-radius': '4px',
                border: 'none',
                background: retrying() ? '#39414b' : '#58a6ff',
                color: '#0d1117',
                cursor: retrying() ? 'default' : 'pointer',
                'font-size': '13px',
                'font-weight': 600,
              }}
            >
              {retrying() ? 'Retrying…' : 'Retry now'}
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}
