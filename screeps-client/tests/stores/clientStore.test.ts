import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

class FakeScreepsClient {
  static instances: FakeScreepsClient[] = []
  static socketClosesDuringConnect = false
  disconnectCalls = 0
  http = { on: () => ({ dispose: () => {} }), token: 'tok', isReachable: vi.fn(async () => true) }
  socket = {}
  stores = {
    server: new FakeStore(),
    user: new FakeStore(),
    room: { resetTerrain: vi.fn() },
  }
  constructor(readonly opts: { url: string; persistTerrain?: boolean; exactWorldBounds?: boolean }) {
    FakeScreepsClient.instances.push(this)
  }
  async connect() {
    if (!FakeScreepsClient.socketClosesDuringConnect) return
    this.stores.server.emit('server:disconnected', { willReconnect: true, intentional: false })
    throw new Error('WebSocket closed before auth completed')
  }
  disconnect() { this.disconnectCalls++ }
}

vi.mock('screeps-connectivity', () => ({
  ScreepsClient: FakeScreepsClient,
  PasswordAuth: class {},
  TokenAuth: class {},
  GuestAuth: class {},
  IndexedDBStorage: class {},
}))

beforeEach(() => {
  FakeScreepsClient.instances = []
  FakeScreepsClient.socketClosesDuringConnect = false
})

describe('clientStore terrain persistence', () => {
  it('persists terrain for remote servers', async () => {
    const { connect } = await import('../../src/stores/clientStore.js')
    await connect({ url: 'https://screeps.com', auth: 'password', email: 'a@b.c', password: 'pw' })
    expect(FakeScreepsClient.instances[0].opts.persistTerrain).toBe(true)
  })

  it.each(['http://localhost:21025', 'http://192.168.1.20:21025'])('reloads terrain on every connection to %s', async (url) => {
    const { connect } = await import('../../src/stores/clientStore.js')
    await connect({ url, auth: 'password', email: 'a@b.c', password: 'pw' })
    expect(FakeScreepsClient.instances[0].opts.persistTerrain).toBe(false)
  })
})

describe('clientStore world bounds', () => {
  it('keeps probed world bounds for remote servers', async () => {
    const { connect } = await import('../../src/stores/clientStore.js')
    await connect({ url: 'https://screeps.com', auth: 'password', email: 'a@b.c', password: 'pw' })
    expect(FakeScreepsClient.instances[0].opts.exactWorldBounds).toBe(false)
  })

  it.each(['http://localhost:21025', 'http://192.168.1.20:21025'])('scans exact world bounds on %s', async (url) => {
    const { connect } = await import('../../src/stores/clientStore.js')
    await connect({ url, auth: 'password', email: 'a@b.c', password: 'pw' })
    expect(FakeScreepsClient.instances[0].opts.exactWorldBounds).toBe(true)
  })
})

describe('clientStore local server connection loss', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(async () => {
    const { disconnect } = await import('../../src/stores/clientStore.js')
    disconnect()
    vi.useRealTimers()
  })

  async function connectTo(url: string) {
    const store = await import('../../src/stores/clientStore.js')
    await store.connect({ url, auth: 'password', email: 'a@b.c', password: 'pw' })
    return { store, instance: FakeScreepsClient.instances[FakeScreepsClient.instances.length - 1] }
  }

  it('gives up the session as soon as the socket to a local server drops', async () => {
    const { store, instance } = await connectTo('http://localhost:21025')

    instance.stores.server.emit('server:disconnected', { willReconnect: true, intentional: false })

    expect(store.sessionError()).toBe(store.LOCAL_SERVER_LOST)
    expect(instance.disconnectCalls).toBe(1)
  })

  it('gives up the session when a local server stops answering while its socket stays open', async () => {
    const { store, instance } = await connectTo('http://127.0.0.1:21025')
    instance.http.isReachable.mockResolvedValue(false)

    await vi.advanceTimersByTimeAsync(store.LIVENESS_PROBE_MS)

    expect(store.sessionError()).toBe(store.LOCAL_SERVER_LOST)
    expect(instance.disconnectCalls).toBe(1)
  })

  it('keeps the session while a local server keeps answering', async () => {
    const { store, instance } = await connectTo('http://localhost:21025')

    await vi.advanceTimersByTimeAsync(store.LIVENESS_PROBE_MS * 3)

    expect(instance.http.isReachable).toHaveBeenCalledTimes(3)
    expect(store.sessionError()).toBe(null)
    expect(instance.disconnectCalls).toBe(0)
  })

  it('stops probing once the session is given up', async () => {
    const { store, instance } = await connectTo('http://localhost:21025')
    instance.stores.server.emit('server:disconnected', { willReconnect: true, intentional: false })

    await vi.advanceTimersByTimeAsync(store.LIVENESS_PROBE_MS * 3)

    expect(instance.http.isReachable).not.toHaveBeenCalled()
  })

  it('stops probing after logout', async () => {
    const { store, instance } = await connectTo('http://localhost:21025')
    store.disconnect()

    await vi.advanceTimersByTimeAsync(store.LIVENESS_PROBE_MS * 3)

    expect(instance.http.isReachable).not.toHaveBeenCalled()
  })

  it('leaves the session alone when logging in to a local server fails', async () => {
    const store = await import('../../src/stores/clientStore.js')
    FakeScreepsClient.socketClosesDuringConnect = true

    await expect(store.connect({ url: 'http://localhost:21025', auth: 'password', email: 'a@b.c', password: 'pw' })).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(store.LIVENESS_PROBE_MS * 3)

    expect(store.sessionError()).toBe(null)
    expect(FakeScreepsClient.instances[0].http.isReachable).not.toHaveBeenCalled()
  })

  it('never probes a remote server', async () => {
    const { store, instance } = await connectTo('https://screeps.com')

    await vi.advanceTimersByTimeAsync(store.LIVENESS_PROBE_MS * 3)

    expect(instance.http.isReachable).not.toHaveBeenCalled()
  })

  it('lets a remote server socket reconnect on its own', async () => {
    const { store, instance } = await connectTo('https://screeps.com')

    instance.stores.server.emit('server:disconnected', { willReconnect: true, intentional: false })

    expect(store.sessionError()).toBe(null)
    expect(instance.disconnectCalls).toBe(0)
  })

  it('retries a lost local session every second without backing off', async () => {
    const { store } = await connectTo('http://localhost:21025')
    expect([0, 1, 5, 20].map(store.sessionRetryDelayMs)).toEqual([1000, 1000, 1000, 1000])
  })

  it('backs off retries of a lost remote session up to 30 seconds', async () => {
    const { store } = await connectTo('https://screeps.com')
    expect([0, 1, 2, 3, 4].map(store.sessionRetryDelayMs)).toEqual([3000, 6000, 12000, 24000, 30000])
  })
})

describe('clientStore fatal-disconnect handling', () => {
  it('disconnects the underlying client when the server reports an unrecoverable disconnect', async () => {
    const { connect, sessionError } = await import('../../src/stores/clientStore.js')
    await connect({ url: 'https://test.local', auth: 'password', email: 'a@b.c', password: 'pw' })
    const instance = FakeScreepsClient.instances[0]

    instance.stores.server.emit('server:disconnected', { willReconnect: false, intentional: false })

    expect(sessionError()).toBe('Lost connection to the server.')
    expect(instance.disconnectCalls).toBe(1)
  })

  it('disconnects the underlying client on a fatal server:error', async () => {
    const { connect, sessionError } = await import('../../src/stores/clientStore.js')
    await connect({ url: 'https://test.local', auth: 'password', email: 'a@b.c', password: 'pw' })
    const instance = FakeScreepsClient.instances[0]

    instance.stores.server.emit('server:error', { error: new Error('boom') })

    expect(sessionError()).toBe('boom')
    expect(instance.disconnectCalls).toBe(1)
  })

  it('does not disconnect or set sessionError for an intentional/reconnecting disconnect', async () => {
    const { connect, sessionError } = await import('../../src/stores/clientStore.js')
    await connect({ url: 'https://test.local', auth: 'password', email: 'a@b.c', password: 'pw' })
    const instance = FakeScreepsClient.instances[0]

    instance.stores.server.emit('server:disconnected', { willReconnect: true, intentional: false })
    expect(sessionError()).toBe(null)
    expect(instance.disconnectCalls).toBe(0)

    instance.stores.server.emit('server:disconnected', { willReconnect: false, intentional: true })
    expect(sessionError()).toBe(null)
    expect(instance.disconnectCalls).toBe(0)
  })

  it('clears sessionError once the client reports it reconnected', async () => {
    const { connect, sessionError } = await import('../../src/stores/clientStore.js')
    await connect({ url: 'https://test.local', auth: 'password', email: 'a@b.c', password: 'pw' })
    const instance = FakeScreepsClient.instances[0]

    instance.stores.server.emit('server:disconnected', { willReconnect: false, intentional: false })
    expect(sessionError()).toBe('Lost connection to the server.')

    instance.stores.server.emit('server:connected', {})
    expect(sessionError()).toBe(null)
  })
})
