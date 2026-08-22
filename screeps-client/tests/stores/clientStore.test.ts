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

class FakeScreepsClient {
  static instances: FakeScreepsClient[] = []
  disconnectCalls = 0
  http = { on: () => ({ dispose: () => {} }), token: 'tok' }
  socket = {}
  stores = {
    server: new FakeStore(),
    user: new FakeStore(),
  }
  constructor() {
    FakeScreepsClient.instances.push(this)
  }
  async connect() {}
  disconnect() { this.disconnectCalls++ }
}

vi.mock('screeps-connectivity', () => ({
  ScreepsClient: FakeScreepsClient,
  PasswordAuth: class {},
  TokenAuth: class {},
  GuestAuth: class {},
  IndexedDBStorage: class {},
}))

beforeEach(() => { FakeScreepsClient.instances = [] })

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
