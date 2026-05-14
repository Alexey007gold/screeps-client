import { createSignal } from 'solid-js'
import { ScreepsClient, PasswordAuth, TokenAuth, GuestAuth, IndexedDBStorage } from 'screeps-connectivity'
import type { AuthStrategy, StorageAdapter, UserInfo, ServerVersion } from 'screeps-connectivity'

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error'

const [client, setClient] = createSignal<ScreepsClient | null>(null)
const [status, setStatus] = createSignal<ConnectionStatus>('idle')
const [error, setError] = createSignal<string | null>(null)
const [userInfo, setUserInfo] = createSignal<UserInfo | null>(null)
const [serverVersion, setServerVersion] = createSignal<ServerVersion | null>(null)
const [gameTime, setGameTime] = createSignal<number | null>(null)
const [tickDuration, setTickDuration] = createSignal<number | null>(null)

let lastGameTime = -1
let lastTickTimestamp = -1
const tickDurations: number[] = []
const MAX_TICK_SAMPLES = 5

export function recordGameTime(gt: number | undefined): void {
  if (gt === undefined) return
  const now = Date.now()
  if (lastGameTime >= 0 && gt > lastGameTime) {
    const elapsed = now - lastTickTimestamp
    if (elapsed > 0) {
      tickDurations.push(elapsed)
      if (tickDurations.length > MAX_TICK_SAMPLES) {
        tickDurations.shift()
      }
      const avg = tickDurations.reduce((a, b) => a + b, 0) / tickDurations.length
      setTickDuration(Math.round(avg))
    }
  }
  lastGameTime = gt
  lastTickTimestamp = now
}

export function resetTickTracking(): void {
  lastGameTime = -1
  lastTickTimestamp = -1
  tickDurations.length = 0
  setTickDuration(null)
}

export const isPrivateServer = () => {
  const v = serverVersion()
  if (!v) return null
  return (v.serverData?.shards?.length ?? 0) === 0
}

export { client, status, error, userInfo, serverVersion, gameTime, setGameTime, tickDuration, setTickDuration }

export async function connect(opts: {
  url: string
  auth: 'password' | 'token' | 'guest'
  email?: string
  password?: string
  token?: string
  storage?: StorageAdapter | null
}): Promise<void> {
  setStatus('connecting')
  setError(null)

  try {
    let authStrategy: AuthStrategy
    if (opts.auth === 'guest') {
      authStrategy = new GuestAuth()
    } else if (opts.auth === 'password') {
      if (!opts.email || !opts.password) {
        throw new Error('Email and password are required')
      }
      authStrategy = new PasswordAuth({ email: opts.email, password: opts.password })
    } else {
      if (!opts.token) {
        throw new Error('Token is required')
      }
      authStrategy = new TokenAuth({ token: opts.token })
    }

    const screepsClient = new ScreepsClient({
      url: opts.url,
      auth: authStrategy,
      storage: opts.storage ?? new IndexedDBStorage('screeps-client'),
      debug: import.meta.env.DEV,
    })

    screepsClient.stores.server.on('server:disconnected', (data) => {
      if (!data.willReconnect) {
        setStatus('idle')
        setClient(null)
        setUserInfo(null)
        setServerVersion(null)
      }
    })

    screepsClient.stores.server.on('server:error', (data) => {
      setError(data.error.message)
      setStatus('error')
    })

    screepsClient.stores.user.on('user:me', (info) => setUserInfo(info))
    screepsClient.stores.server.on('server:version', (v) => setServerVersion(v))

    await screepsClient.connect()
    setClient(screepsClient)
    setStatus('connected')
    console.log('Connected to Screeps server', opts.url)
    // Persist credentials for auto-reconnect on reload
    localStorage.setItem('screeps:url', opts.url)
    if (screepsClient.http.token) {
      localStorage.setItem('screeps:token', screepsClient.http.token)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setError(message)
    setStatus('error')
    setClient(null)
    throw err
  }
}

export async function tryAutoConnect(): Promise<void> {
  const url = localStorage.getItem('screeps:url')
  const token = localStorage.getItem('screeps:token')
  if (!url || !token) return

  try {
    await connect({ url, auth: 'token', token })
  } catch {
    // Invalid or expired token — clear it so user sees login form
    localStorage.removeItem('screeps:token')
  }
}

export function disconnect(): void {
  const c = client()
  if (c) {
    c.disconnect()
  }
  setClient(null)
  setStatus('idle')
  setError(null)
  setUserInfo(null)
  setServerVersion(null)
  setGameTime(null)
  resetTickTracking()
  localStorage.removeItem('screeps:token')
}
