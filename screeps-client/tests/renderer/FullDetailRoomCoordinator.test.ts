import { describe, it, expect, vi } from 'vitest'
import type { ScreepsClient, Subscription } from 'screeps-connectivity'
import {
  FullDetailRoomCoordinator,
  ROOMS_PER_CONNECTION,
  MAX_POOL_CONNECTIONS,
  PRIVATE_MAX_FULL_ROOMS,
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
    emitTokenRefresh: (token: string) => tokenRefreshListeners.forEach((cb) => cb({ token })),
    setToken,
    socketSetToken,
    subscribeCalls,
    roomUpdateListeners,
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
    it('fills the primary before opening a secondary connection', async () => {
      const primary = makeFakeClient()
      const secondary = makeFakeClient()
      const createSecondary = vi.fn(() => secondary)
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => false, createSecondary,
      })

      coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W2N1', 'shard0')
      expect(createSecondary).not.toHaveBeenCalled()
      expect(primary.subscribeCalls).toHaveLength(2)

      coordinator.subscribeFullDetailRoom('W3N1', 'shard0')
      expect(createSecondary).toHaveBeenCalledTimes(1)
      await flush()
      expect(secondary.subscribeCalls.map((c) => c.room)).toEqual(['W3N1'])
    })

    it('re-places rooms from a secondary that permanently fails to connect, and shrinks capacity', async () => {
      const primary = makeFakeClient()
      const failing = makeFakeClient({ connect: () => Promise.reject(new Error('auth failed')) })
      const healthy = makeFakeClient()
      const createSecondary = vi.fn().mockReturnValueOnce(failing).mockReturnValueOnce(healthy)
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => false, createSecondary,
      })

      coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W2N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W3N1', 'shard0')
      await flush()
      await flush()

      expect(createSecondary).toHaveBeenCalledTimes(2)
      expect(failing.subscribeCalls).toHaveLength(0)
      expect(healthy.subscribeCalls.map((c) => c.room)).toEqual(['W3N1'])
      expect(coordinator.capacity()).toBe(ROOMS_PER_CONNECTION * (MAX_POOL_CONNECTIONS - 1))
    })

    it('re-places rooms when a live secondary reports a permanent server:error', async () => {
      const primary = makeFakeClient()
      const secondaryA = makeFakeClient()
      const secondaryB = makeFakeClient()
      const createSecondary = vi.fn().mockReturnValueOnce(secondaryA).mockReturnValueOnce(secondaryB)
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => false, createSecondary,
      })

      coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W2N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W3N1', 'shard0')
      await flush()
      expect(secondaryA.subscribeCalls.map((c) => c.room)).toEqual(['W3N1'])

      secondaryA.emitServerError()
      await flush()

      expect(secondaryA.disconnect).toHaveBeenCalledOnce()
      expect(createSecondary).toHaveBeenCalledTimes(2)
      expect(secondaryB.subscribeCalls.map((c) => c.room)).toEqual(['W3N1'])
      expect(coordinator.capacity()).toBe(ROOMS_PER_CONNECTION * (MAX_POOL_CONNECTIONS - 1))
    })

    it("forwards the primary's rotated session token to live secondaries", async () => {
      const primary = makeFakeClient()
      const secondary = makeFakeClient()
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => false, createSecondary: () => secondary,
      })

      coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W2N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W3N1', 'shard0')
      await flush()

      primary.emitTokenRefresh('fresh-token')
      expect(secondary.setToken).toHaveBeenCalledWith('fresh-token')
      expect(secondary.socketSetToken).toHaveBeenCalledWith('fresh-token')
    })
  })

  describe('subscription lifecycle', () => {
    it('is idempotent — a second subscribe for the same room/shard is a no-op', () => {
      const primary = makeFakeClient()
      const coordinator = new FullDetailRoomCoordinator({ getPrimary: () => primary, isPrivate: () => true })

      const first = coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      const second = coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      expect(primary.subscribeCalls).toHaveLength(1)

      second.dispose()
      expect(primary.subscribeCalls[0].dispose).not.toHaveBeenCalled()
      first.dispose()
      expect(primary.subscribeCalls[0].dispose).toHaveBeenCalledOnce()
    })

    it('cancels a pending placement disposed before its connection finishes connecting', async () => {
      const primary = makeFakeClient()
      const secondary = makeFakeClient()
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => false, createSecondary: () => secondary,
      })

      coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W2N1', 'shard0')
      const third = coordinator.subscribeFullDetailRoom('W3N1', 'shard0')
      third.dispose()
      await flush()

      expect(secondary.subscribeCalls).toHaveLength(0)
    })
  })

  describe('onRoomUpdate funnel', () => {
    it('forwards updates from both the primary and pooled secondaries', async () => {
      const primary = makeFakeClient()
      const secondary = makeFakeClient()
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => false, createSecondary: () => secondary,
      })
      const handler = vi.fn()
      coordinator.onRoomUpdate(handler)

      coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W2N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W3N1', 'shard0')
      await flush()

      primary.emitRoomUpdate({ room: 'W1N1' })
      secondary.emitRoomUpdate({ room: 'W3N1' })
      expect(handler).toHaveBeenCalledTimes(2)
    })
  })

  describe('reset() and dispose()', () => {
    it('reset() disconnects secondaries and disposes room subs, keeping the primary', async () => {
      const primary = makeFakeClient()
      const secondary = makeFakeClient()
      const coordinator = new FullDetailRoomCoordinator({
        getPrimary: () => primary, isPrivate: () => false, createSecondary: () => secondary,
      })

      coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W2N1', 'shard0')
      coordinator.subscribeFullDetailRoom('W3N1', 'shard0')
      await flush()

      coordinator.reset()

      expect(secondary.disconnect).toHaveBeenCalledOnce()
      expect(primary.disconnect).not.toHaveBeenCalled()
      for (const call of [...primary.subscribeCalls, ...secondary.subscribeCalls]) {
        expect(call.dispose).toHaveBeenCalledOnce()
      }
      expect(coordinator.capacity()).toBe(ROOMS_PER_CONNECTION * MAX_POOL_CONNECTIONS)
    })

    it('dispose() also removes the primary funnel listeners', () => {
      const primary = makeFakeClient()
      const coordinator = new FullDetailRoomCoordinator({ getPrimary: () => primary, isPrivate: () => true })

      coordinator.subscribeFullDetailRoom('W1N1', 'shard0')
      expect(primary.roomUpdateListeners.size).toBe(1)

      coordinator.dispose()
      expect(primary.roomUpdateListeners.size).toBe(0)
    })
  })
})
