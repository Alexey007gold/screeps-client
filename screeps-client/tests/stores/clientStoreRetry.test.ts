import { describe, it, expect, vi, beforeEach } from 'vitest'

class FakeStore {
  private listeners = new Map<string, Set<(data: unknown) => void>>()
  on(channel: string, cb: (data: unknown) => void) {
    let set = this.listeners.get(channel)
    if (!set) { set = new Set(); this.listeners.set(channel, set) }
    set.add(cb)
    return { dispose: () => set!.delete(cb) }
  }
  emit(channel: string, data: unknown) {
    this.listeners.get(channel)?.forEach((cb) => cb(data))
  }
  subscribeUserStream() {}
}

class FakeSocketAuthError extends Error {}

class FakePasswordAuth {
  constructor(public opts: { email: string; password: string }) {}
}

class FakeTokenAuth {
  constructor(public opts: { token: string }) {}
}

type Failure = 'none' | 'tokenRejected' | 'serverDown'

class FakeScreepsClient {
  static instances: FakeScreepsClient[] = []
  static failure: Failure = 'none'
  disconnectCalls = 0
  http = { on: () => ({ dispose: () => {} }), token: 'fresh-session-token' }
  socket = {}
  stores = {
    server: new FakeStore(),
    user: new FakeStore(),
  }
  constructor(public opts: { auth: unknown }) {
    FakeScreepsClient.instances.push(this)
  }
  async connect() {
    if (FakeScreepsClient.failure === 'serverDown') throw new Error('connection refused')
    if (FakeScreepsClient.failure === 'tokenRejected' && this.opts.auth instanceof FakeTokenAuth) {
      throw new FakeSocketAuthError('WebSocket auth failed')
    }
  }
  disconnect() { this.disconnectCalls++ }
}

const secrets = new Map<string, string>()

vi.mock('screeps-connectivity', () => ({
  ScreepsClient: FakeScreepsClient,
  PasswordAuth: FakePasswordAuth,
  TokenAuth: FakeTokenAuth,
  GuestAuth: class {},
  IndexedDBStorage: class {},
  SocketAuthError: FakeSocketAuthError,
}))

vi.mock('../../src/utils/tauri.js', () => ({ isTauri: () => true }))

vi.mock('../../src/utils/keychain.js', () => ({
  saveTokenForUrl: async (url: string, token: string) => { secrets.set(`${url}:token`, token) },
  loadTokenForUrl: async (url: string) => secrets.get(`${url}:token`) ?? null,
  deleteTokenForUrl: async (url: string) => { secrets.delete(`${url}:token`) },
  saveServerPasswordForUrl: async () => {},
  loadServerPasswordForUrl: async () => null,
  deleteServerPasswordForUrl: async () => {},
  loadSavedCredential: async (url: string, type: string) => secrets.get(`${url}:saved:${type}`) ?? null,
  deleteSavedCredential: async (url: string, type: string) => { secrets.delete(`${url}:saved:${type}`) },
}))

const URL = 'http://test-server.local:21025'

beforeEach(() => {
  FakeScreepsClient.instances = []
  FakeScreepsClient.failure = 'none'
  secrets.clear()
  localStorage.clear()
})

function lastInstance() {
  return FakeScreepsClient.instances[FakeScreepsClient.instances.length - 1]
}

describe('retryConnection after the server restarted and rejects the session token', () => {
  it('logs in again with the saved password and the login used for this session', async () => {
    const { connect, retryConnection, client, sessionError } = await import('../../src/stores/clientStore.js')
    secrets.set(`${URL}:saved:password`, 'saved-pw')
    await connect({ url: URL, auth: 'password', email: 'me@mail.test', password: 'saved-pw', storage: null })
    const original = lastInstance()
    original.stores.server.emit('server:error', { error: new Error('WebSocket auth failed') })
    FakeScreepsClient.failure = 'tokenRejected'

    const recovered = await retryConnection()

    const relogin = lastInstance()
    expect(recovered).toBe(true)
    expect(relogin.opts.auth).toBeInstanceOf(FakePasswordAuth)
    expect((relogin.opts.auth as FakePasswordAuth).opts).toEqual({ email: 'me@mail.test', password: 'saved-pw' })
    expect(client()).toBe(relogin)
    expect(sessionError()).toBe(null)
    const rejectedTokenAttempt = FakeScreepsClient.instances[FakeScreepsClient.instances.length - 2]
    expect(rejectedTokenAttempt.opts.auth).toBeInstanceOf(FakeTokenAuth)
    expect(rejectedTokenAttempt.disconnectCalls).toBe(1)
  })

  it('falls back to the signed-in username when the session was restored from a cached token', async () => {
    const { tryAutoConnect, retryConnection, client } = await import('../../src/stores/clientStore.js')
    secrets.set(`${URL}:saved:password`, 'saved-pw')
    secrets.set(`${URL}:token`, 'cached-session-token')
    localStorage.setItem('screeps:url', URL)
    localStorage.setItem('screeps:authMethod', 'password')
    await tryAutoConnect()
    const restored = lastInstance()
    restored.stores.user.emit('user:me', { username: 'player', _id: 'u1' })
    restored.stores.server.emit('server:error', { error: new Error('WebSocket auth failed') })
    FakeScreepsClient.failure = 'tokenRejected'

    const recovered = await retryConnection()

    expect(recovered).toBe(true)
    expect((lastInstance().opts.auth as FakePasswordAuth).opts).toEqual({ email: 'player', password: 'saved-pw' })
    expect(client()).toBe(lastInstance())
  })

  it('does not attempt a password sign-in while the server is still unreachable', async () => {
    const { connect, retryConnection } = await import('../../src/stores/clientStore.js')
    secrets.set(`${URL}:saved:password`, 'saved-pw')
    await connect({ url: URL, auth: 'password', email: 'me@mail.test', password: 'saved-pw', storage: null })
    lastInstance().stores.server.emit('server:error', { error: new Error('reconnection failed') })
    FakeScreepsClient.failure = 'serverDown'
    const before = FakeScreepsClient.instances.length

    const recovered = await retryConnection()

    expect(recovered).toBe(false)
    const attempts = FakeScreepsClient.instances.slice(before)
    expect(attempts).toHaveLength(1)
    expect(attempts[0].opts.auth).toBeInstanceOf(FakeTokenAuth)
    expect(attempts[0].disconnectCalls).toBe(1)
  })
})
