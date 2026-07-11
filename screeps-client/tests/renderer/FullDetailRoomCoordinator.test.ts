import { describe, it, expect, vi } from 'vitest'
import type { ScreepsClient, Subscription } from 'screeps-connectivity'
import {
  FullDetailRoomCoordinator,
  ROOMS_PER_CONNECTION,
  MAX_POOL_CONNECTIONS,
  PRIVATE_MAX_FULL_ROOMS,
  CONTENTION_WINDOW,
  CONTENTION_ERROR_THRESHOLD,
} from '../../src/renderer/FullDetailRoomCoordinator'

type Listener = (data: unknown) => void

function makeFakeClient(opts: { connect?: () => Promise<void> } = {}) {
  const roomUpdateListeners = new Set<Listener>()
  const roomErrorListeners = new Set<Listener>()
  const serverErrorListeners = new Set<Listener>()
  const tokenRefreshListeners = new Set<Listener>()
  const subscribeCalls: { room: string; shard: string | null; dispose: ReturnType<typeof vi.fn> }[] = []
  const setToken = vi.fn()
  const socketSetToken = vi.fn()

  const fake = {
    url: 'https://example.test',
    http: {
      token: 'tok',
      setToken,
      on: (type: string, cb: Listener): Subscription => {
        if (type !== 'http:tokenRefresh') return { dispose: () => {} }
        tokenRefreshListeners.add(cb)
        return { dispose: () => tokenRefreshListeners.delete(cb) }
      },
    },
    socket: { setToken: socketSetToken },
    stores: {
      room: {
        on: (type: string, cb: Listener): Subscription => {
          const set = type === 'room:update' ? roomUpdateListeners : roomErrorListeners
          set.add(cb)
          return { dispose: () => set.delete(cb) }
        },
        subscribe: (room: string, shard: string | null): Subscription => {
          const dispose = vi.fn()
          subscribeCalls.push({ room, shard, dispose })
          return { dispose }
        },
      },
      server: {
        on: (type: string, cb: Listener): Subscription => {
          serverErrorListeners.add(cb)
          return { dispose: () => serverErrorListeners.delete(cb) }
        },
      },
    },
    connect: opts.connect ?? vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(),
    emitServerError: () => serverErrorListeners.forEach((cb) => cb({ error: new Error('boom') })),
    emitRoomUpdate: (data: unknown) => roomUpdateListeners.forEach((cb) => cb(data)),
    emitRoomError: (data: unknown) => roomErrorListeners.forEach((cb) => cb(data)),
    emitTokenRefresh: (token: string) => tokenRefreshListeners.forEach((cb) => cb({ token })),
    setToken,
    socketSetToken,
    subscribeCalls,
    roomUpdateListeners,
    tokenRefreshListeners,
  }
  return fake as unknown as ScreepsClient & typeof fake
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('FullDetailRoomCoordinator', () => {
  describe('capacity()', () => {
    it('caps at PRIVATE_MAX_FULL_ROOMS on a private server', () => {
      const c = new FullDetailRoomCoordinator({ getPrimary: () => null, isPrivate: () => true })
      expect(c.capacity()).toBe(PRIVATE_MAX_FULL_ROOMS)
    })

    it('treats an unknown regime as private (safe default)', () => {
      const c = new FullDetailRoomCoordinator({ getPrimary: () => null, isPrivate: () => null })
      expect(c.capacity()).toBe(PRIVATE_MAX_FULL_ROOMS)
    })

    it('pools on an official server regardless of login/auth method', () => {
      const c = new FullDetailRoomCoordinator({ getPrimary: () => null, isPrivate: () => false })
      expect(c.capacity()).toBe(ROOMS_PER_CONNECTION * MAX_POOL_CONNECTIONS)
    })
  })

  describe('official-server pooling', () => {
    it('never subscribes rooms on the primary — the first room already opens a dedicated connection', async () => {
      const primary = makeFakeClient()
      const conn1 = makeFakeClient()
      const createSecondary = vi.fn(() => conn1)
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => false, createSecondary,
      })

      coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W2N1', 'shard0')
      await flush()

      expect(primary.subscribeCalls).toHaveLength(0)
      expect(createSecondary).toHaveBeenCalledTimes(1)
      expect(conn1.subscribeCalls.map((c) => c.room)).toEqual(['W1N1', 'W2N1'])

      coordinator.subscribeFullDetailRoom('W3N1', 'shard0')
      expect(createSecondary).toHaveBeenCalledTimes(2)
    })

    it('re-places rooms from a connection that permanently fails to connect, and shrinks capacity', async () => {
      const primary = makeFakeClient()
      const failing = makeFakeClient({ connect: () => Promise.reject(new Error('auth failed')) })
      const healthy = makeFakeClient()
      const createSecondary = vi.fn().mockReturnValueOnce(failing).mockReturnValueOnce(healthy)
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => false, createSecondary,
      })

      coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W2N1', 'shard0')
      await flush()
      await flush()

      expect(createSecondary).toHaveBeenCalledTimes(2)
      expect(failing.subscribeCalls).toHaveLength(0)
      expect(healthy.subscribeCalls.map((c) => c.room)).toEqual(['W1N1', 'W2N1'])
      expect(coordinator.capacity()).toBe(ROOMS_PER_CONNECTION * (MAX_POOL_CONNECTIONS - 1))
    })

    it('re-places rooms when a live connection reports a permanent server:error', async () => {
      const primary = makeFakeClient()
      const conn1 = makeFakeClient()
      const conn2 = makeFakeClient()
      const createSecondary = vi.fn().mockReturnValueOnce(conn1).mockReturnValueOnce(conn2)
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => false, createSecondary,
      })

      coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W2N1', 'shard0')
      await flush()
      expect(conn1.subscribeCalls.map((c) => c.room)).toEqual(['W1N1', 'W2N1'])

      conn1.emitServerError()
      await flush()

      expect(conn1.disconnect).toHaveBeenCalledOnce()
      expect(createSecondary).toHaveBeenCalledTimes(2)
      expect(conn2.subscribeCalls.map((c) => c.room)).toEqual(['W1N1', 'W2N1'])
      expect(coordinator.capacity()).toBe(ROOMS_PER_CONNECTION * (MAX_POOL_CONNECTIONS - 1))
    })

    it('reconnects a connection showing repeated subscribe-limit errors, without shrinking capacity', async () => {
      const primary = makeFakeClient()
      const connA = makeFakeClient()
      const connB = makeFakeClient()
      const createSecondary = vi.fn().mockReturnValueOnce(connA).mockReturnValueOnce(connB)
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => false, createSecondary,
      })

      coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W2N1', 'shard0')
      await flush()
      expect(connA.subscribeCalls.map((c) => c.room)).toEqual(['W1N1', 'W2N1'])

      expect(CONTENTION_WINDOW).toBe(10)
      expect(CONTENTION_ERROR_THRESHOLD).toBe(2)
      for (let i = 0; i < 8; i++) connA.emitRoomUpdate({ room: 'W1N1' })
      connA.emitRoomError({ room: 'W1N1', message: 'subscribe limit reached' })
      expect(connA.disconnect).not.toHaveBeenCalled() // only 1 error in the window so far — not yet over threshold
      connA.emitRoomError({ room: 'W2N1', message: 'subscribe limit reached' })
      await flush()

      expect(connA.disconnect).toHaveBeenCalledOnce()
      expect(createSecondary).toHaveBeenCalledTimes(2)
      expect(connB.subscribeCalls.map((c) => c.room).sort()).toEqual(['W1N1', 'W2N1'])
      expect(coordinator.capacity()).toBe(ROOMS_PER_CONNECTION * MAX_POOL_CONNECTIONS)
    })

    it("forwards the primary's rotated session token to every dedicated connection", async () => {
      const primary = makeFakeClient()
      const conn1 = makeFakeClient()
      const conn2 = makeFakeClient()
      const createSecondary = vi.fn().mockReturnValueOnce(conn1).mockReturnValueOnce(conn2)
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => false, createSecondary,
      })

      coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W2N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W3N1', 'shard0')
      await flush()

      primary.emitTokenRefresh('fresh-token')
      expect(conn1.setToken).toHaveBeenCalledWith('fresh-token')
      expect(conn1.socketSetToken).toHaveBeenCalledWith('fresh-token')
      expect(conn2.setToken).toHaveBeenCalledWith('fresh-token')
      expect(conn2.socketSetToken).toHaveBeenCalledWith('fresh-token')
    })
  })

  describe('private-server single connection', () => {
    it('never opens more than one dedicated connection and never touches the primary', async () => {
      const primary = makeFakeClient()
      const conn1 = makeFakeClient()
      const createSecondary = vi.fn(() => conn1)
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => true, createSecondary,
      })

      for (let i = 0; i < 4; i++) coordinator.subscribeFullDetailRoom(`W${i}N1`, 'shard0')
      await flush()

      expect(createSecondary).toHaveBeenCalledTimes(1)
      expect(primary.subscribeCalls).toHaveLength(0)
      expect(conn1.subscribeCalls.map((c) => c.room)).toEqual(['W0N1', 'W1N1', 'W2N1', 'W3N1'])
      expect(coordinator.capacity()).toBe(PRIVATE_MAX_FULL_ROOMS)
    })
  })

  describe('subscription lifecycle', () => {
    it('is idempotent — a second subscribe for the same room/shard is a no-op', async () => {
      const primary = makeFakeClient()
      const conn1 = makeFakeClient()
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => false, createSecondary: () => conn1,
      })

      const first = coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      const second = coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      await flush()
      expect(conn1.subscribeCalls).toHaveLength(1)

      second.dispose()
      expect(conn1.subscribeCalls[0].dispose).not.toHaveBeenCalled()
      first.dispose()
      expect(conn1.subscribeCalls[0].dispose).toHaveBeenCalledOnce()
    })

    it('cancels a pending placement disposed before its connection finishes connecting', async () => {
      const primary = makeFakeClient()
      const conn1 = makeFakeClient()
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => false, createSecondary: () => conn1,
      })

      const sub = coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      sub.dispose()
      await flush()

      expect(conn1.subscribeCalls).toHaveLength(0)
    })
  })

  describe('onRoomUpdate funnel', () => {
    it('forwards updates from every dedicated connection, never from the primary', async () => {
      const primary = makeFakeClient()
      const conn1 = makeFakeClient()
      const conn2 = makeFakeClient()
      const createSecondary = vi.fn().mockReturnValueOnce(conn1).mockReturnValueOnce(conn2)
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => false, createSecondary,
      })
      const handler = vi.fn()
      coordinator.onRoomUpdate(handler)

      coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W2N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W3N1', 'shard0')
      await flush()

      expect(primary.roomUpdateListeners.size).toBe(0)
      conn1.emitRoomUpdate({ room: 'W1N1' })
      conn2.emitRoomUpdate({ room: 'W3N1' })
      expect(handler).toHaveBeenCalledTimes(2)
    })
  })

  describe('reset() and dispose()', () => {
    it('reset() disconnects every dedicated connection and disposes room subs; primary is never touched', async () => {
      const primary = makeFakeClient()
      const conn1 = makeFakeClient()
      const conn2 = makeFakeClient()
      const createSecondary = vi.fn().mockReturnValueOnce(conn1).mockReturnValueOnce(conn2)
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => false, createSecondary,
      })

      coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W2N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W3N1', 'shard0')
      await flush()

      coordinator.reset()

      expect(conn1.disconnect).toHaveBeenCalledOnce()
      expect(conn2.disconnect).toHaveBeenCalledOnce()
      expect(primary.disconnect).not.toHaveBeenCalled()
      expect(primary.subscribeCalls).toHaveLength(0)
      for (const call of [...conn1.subscribeCalls, ...conn2.subscribeCalls]) {
        expect(call.dispose).toHaveBeenCalledOnce()
      }
      expect(coordinator.capacity()).toBe(ROOMS_PER_CONNECTION * MAX_POOL_CONNECTIONS)
    })

    it("dispose() also removes the primary's token-refresh listener", async () => {
      const primary = makeFakeClient()
      const conn1 = makeFakeClient()
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => false, createSecondary: () => conn1,
      })

      coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      await flush()
      expect(primary.tokenRefreshListeners.size).toBe(1)

      coordinator.dispose()
      expect(primary.tokenRefreshListeners.size).toBe(0)
    })
  })
})
