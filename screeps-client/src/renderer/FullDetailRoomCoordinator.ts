import { ScreepsClient, TokenAuth, NullStorage } from 'screeps-connectivity'
import type { Subscription, RoomStoreEvents } from 'screeps-connectivity'
import { createLogger } from '~/utils/log.js'

const { log } = createLogger('roomPool')

// Empirical screeps.com USER_LIMIT: full-object `room:` subscriptions are capped
// per WebSocket connection (see docs/project/Room Subscription Limit Investigation.md).
export const ROOMS_PER_CONNECTION = 2
// Total connections in the pool including the primary app client — gives a
// 12-room ceiling on the official server, matching the previous flat MAX_FULL_ROOMS.
export const MAX_POOL_CONNECTIONS = 6
// Private servers enforce the limit account-wide, so pooling doesn't help there —
// single connection, fixed cap. Assumes the operator raised the server's USER_LIMIT
// to match; if not, the extra rooms simply show the server's own limit error.
export const PRIVATE_MAX_FULL_ROOMS = 12
// Delay before disconnecting an idle secondary, so zoom/pan thrash (the same
// reason MultiRoomViewer debounces its reconcile) doesn't churn connect/auth.
export const KEEP_WARM_MS = 5000

export type FullDetailUpdate = RoomStoreEvents['room:update']
export type FullDetailError = RoomStoreEvents['room:error']

interface PoolConnection {
  client: ScreepsClient
  isPrimary: boolean
  state: 'connecting' | 'ready' | 'failed'
  connectPromise: Promise<void> | null
  rooms: Set<string>
  updateSub: Subscription | null
  errorSub: Subscription | null
  serverErrorSub: Subscription | null
  reapTimer: ReturnType<typeof setTimeout> | null
}

export interface FullDetailRoomCoordinatorOptions {
  /** Current primary app client, or null while disconnected. */
  getPrimary: () => ScreepsClient | null
  /** Server regime. null (not yet known, e.g. before /api/version resolves) is treated as private — the safe, non-pooling default. */
  isPrivate: () => boolean | null
  /** Injectable for tests; defaults to a same-url ScreepsClient reusing the primary's token. */
  createSecondary?: (primary: ScreepsClient) => ScreepsClient
}

function roomKey(room: string, shard: string | null): string {
  return `${room}/${shard ?? ''}`
}

function defaultCreateSecondary(primary: ScreepsClient): ScreepsClient {
  return new ScreepsClient({
    url: primary.url,
    auth: new TokenAuth({ token: primary.http.token ?? '' }),
    storage: new NullStorage(),
    tokenRefresh: false,
  })
}

/**
 * Owns the connection(s) backing the grid view's full-detail room subscriptions,
 * so MultiRoomViewer can ask for a room without knowing whether it lands on the
 * single app connection (private servers) or a pooled secondary (official server,
 * where the room-subscription limit is per-connection rather than per-account).
 */
export class FullDetailRoomCoordinator {
  private readonly opts: FullDetailRoomCoordinatorOptions
  private primaryConn: PoolConnection | null = null
  private primaryTokenSub: Subscription | null = null
  private secondaries: PoolConnection[] = []
  private failedConnections = 0

  // Keyed by `${room}/${shard}`.
  private readonly tokens = new Map<string, { cancelled: boolean }>()
  private readonly roomInfo = new Map<string, { room: string; shard: string | null }>()
  private readonly roomToConn = new Map<string, PoolConnection>()
  private readonly roomSubs = new Map<string, Subscription>()

  private readonly updateHandlers = new Set<(data: FullDetailUpdate) => void>()
  private readonly errorHandlers = new Set<(data: FullDetailError) => void>()

  constructor(opts: FullDetailRoomCoordinatorOptions) {
    this.opts = opts
  }

  private maxConnections(): number {
    return Math.max(1, MAX_POOL_CONNECTIONS - this.failedConnections)
  }

  capacity(): number {
    const priv = this.opts.isPrivate()
    if (priv === false) return ROOMS_PER_CONNECTION * this.maxConnections()
    return PRIVATE_MAX_FULL_ROOMS
  }

  private ensurePrimaryConn(): PoolConnection | null {
    const primary = this.opts.getPrimary()
    if (!primary) return null
    if (this.primaryConn && this.primaryConn.client === primary) return this.primaryConn
    // Primary changed (fresh login/reconnect) or first use. The stale client's
    // own teardown is clientStore's job — we just drop our listeners on it.
    this.primaryConn?.updateSub?.dispose()
    this.primaryConn?.errorSub?.dispose()
    this.primaryTokenSub?.dispose()
    const conn: PoolConnection = {
      client: primary, isPrimary: true, state: 'ready', connectPromise: null,
      rooms: new Set(), updateSub: null, errorSub: null, serverErrorSub: null, reapTimer: null,
    }
    this.attachFunnel(conn)
    // A password/steam login's session token rotates (and expires on inactivity)
    // — secondaries snapshot it once at spin-up, so keep every live secondary's
    // stored token current in case one ever needs to reconnect later. Harmless
    // no-op for a durable personal API token (it never rotates).
    this.primaryTokenSub = primary.http.on('http:tokenRefresh', ({ token }) => {
      for (const s of this.secondaries) {
        s.client.http.setToken(token)
        s.client.socket.setToken(token)
      }
    })
    this.primaryConn = conn
    return conn
  }

  private attachFunnel(conn: PoolConnection): void {
    conn.updateSub = conn.client.stores.room.on('room:update', (data) => {
      for (const h of this.updateHandlers) h(data)
    })
    conn.errorSub = conn.client.stores.room.on('room:error', (data) => {
      for (const h of this.errorHandlers) h(data)
    })
    if (!conn.isPrimary) {
      // The primary's own connection loss is already surfaced app-wide
      // (clientStore's server:disconnected/sessionError handling); we only need
      // to self-heal secondaries this coordinator created.
      conn.serverErrorSub = conn.client.stores.server.on('server:error', () => {
        this.handleConnectionFailure(conn)
      })
    }
  }

  private spinUpSecondary(): PoolConnection {
    const primary = this.primaryConn!.client
    const client = this.opts.createSecondary ? this.opts.createSecondary(primary) : defaultCreateSecondary(primary)
    const conn: PoolConnection = {
      client, isPrimary: false, state: 'connecting', connectPromise: null,
      rooms: new Set(), updateSub: null, errorSub: null, serverErrorSub: null, reapTimer: null,
    }
    this.secondaries.push(conn)
    conn.connectPromise = client.connect().then(
      () => { conn.state = 'ready'; this.attachFunnel(conn) },
      (err) => { log('secondary connect failed:', err); this.handleConnectionFailure(conn) },
    )
    return conn
  }

  private handleConnectionFailure(conn: PoolConnection): void {
    if (conn.state === 'failed') return
    conn.state = 'failed'
    this.failedConnections++
    if (conn.reapTimer !== null) { clearTimeout(conn.reapTimer); conn.reapTimer = null }
    conn.updateSub?.dispose()
    conn.errorSub?.dispose()
    conn.serverErrorSub?.dispose()
    try { conn.client.disconnect() } catch { /* already dead */ }
    this.secondaries = this.secondaries.filter((s) => s !== conn)

    const keys = [...conn.rooms]
    conn.rooms.clear()
    for (const key of keys) {
      if (this.roomToConn.get(key) === conn) this.roomToConn.delete(key)
      this.roomSubs.get(key)?.dispose()
      this.roomSubs.delete(key)
      this.replaceOne(key)
    }
  }

  private replaceOne(key: string): void {
    const token = this.tokens.get(key)
    if (!token || token.cancelled) return
    void this.place(key, token)
  }

  private reserveConnection(key: string): PoolConnection | null {
    const primary = this.ensurePrimaryConn()
    if (!primary) return null

    const poolable = this.opts.isPrivate() === false

    if (!poolable) {
      if (primary.rooms.size >= PRIVATE_MAX_FULL_ROOMS) return null
      primary.rooms.add(key)
      return primary
    }

    if (primary.rooms.size < ROOMS_PER_CONNECTION) {
      primary.rooms.add(key)
      return primary
    }
    const liveSecondaries = this.secondaries.filter((s) => s.state !== 'failed')
    for (const s of liveSecondaries) {
      if (s.rooms.size < ROOMS_PER_CONNECTION) {
        if (s.reapTimer !== null) { clearTimeout(s.reapTimer); s.reapTimer = null }
        s.rooms.add(key)
        return s
      }
    }
    if (1 + liveSecondaries.length < this.maxConnections()) {
      const fresh = this.spinUpSecondary()
      fresh.rooms.add(key)
      return fresh
    }
    return null
  }

  private async place(key: string, token: { cancelled: boolean }): Promise<void> {
    const conn = this.reserveConnection(key)
    if (!conn) return
    this.roomToConn.set(key, conn)
    if (conn.connectPromise) {
      try { await conn.connectPromise } catch { /* conn.state is now 'failed'; checked below */ }
    }
    // While we were waiting, dispose() or a connection-failure recovery may have
    // already moved (or dropped) this room — roomToConn no longer points back at
    // `conn` in that case. Touching state here would stomp on whatever took over.
    if (this.roomToConn.get(key) !== conn || token.cancelled) return
    const info = this.roomInfo.get(key)
    if (!info) return
    const sub = conn.client.stores.room.subscribe(info.room, info.shard)
    this.roomSubs.set(key, sub)
  }

  private armReap(conn: PoolConnection): void {
    if (conn.isPrimary || conn.rooms.size > 0) return
    if (conn.reapTimer !== null) clearTimeout(conn.reapTimer)
    conn.reapTimer = setTimeout(() => {
      conn.reapTimer = null
      if (conn.rooms.size > 0) return
      this.secondaries = this.secondaries.filter((s) => s !== conn)
      conn.updateSub?.dispose()
      conn.errorSub?.dispose()
      conn.serverErrorSub?.dispose()
      try { conn.client.disconnect() } catch { /* already dead */ }
    }, KEEP_WARM_MS)
  }

  /** Subscribe a room to full-detail live updates. Returns synchronously; the
   *  underlying connection/placement may complete asynchronously and can fail
   *  gracefully (the room just stays terrain-only). */
  subscribeFullDetailRoom(room: string, shard: string | null): Subscription {
    const key = roomKey(room, shard)
    if (this.tokens.has(key)) return { dispose: () => {} }

    const token = { cancelled: false }
    this.tokens.set(key, token)
    this.roomInfo.set(key, { room, shard })
    void this.place(key, token)

    return {
      dispose: () => {
        token.cancelled = true
        this.tokens.delete(key)
        this.roomInfo.delete(key)
        this.roomSubs.get(key)?.dispose()
        this.roomSubs.delete(key)
        const conn = this.roomToConn.get(key)
        if (conn) {
          conn.rooms.delete(key)
          this.roomToConn.delete(key)
          this.armReap(conn)
        }
      },
    }
  }

  /** Funnels `room:update` from every pool connection (primary + secondaries)
   *  through a single handler, mirroring the single-connection listener this replaces. */
  onRoomUpdate(handler: (data: FullDetailUpdate) => void): Subscription {
    this.updateHandlers.add(handler)
    return { dispose: () => { this.updateHandlers.delete(handler) } }
  }

  onRoomError(handler: (data: FullDetailError) => void): Subscription {
    this.errorHandlers.add(handler)
    return { dispose: () => { this.errorHandlers.delete(handler) } }
  }

  /** Drop all room subs and secondary connections; keep the primary. Call on shard change. */
  reset(): void {
    for (const sub of this.roomSubs.values()) sub.dispose()
    this.roomSubs.clear()
    this.roomToConn.clear()
    this.tokens.clear()
    this.roomInfo.clear()
    for (const conn of this.secondaries) {
      if (conn.reapTimer !== null) clearTimeout(conn.reapTimer)
      conn.updateSub?.dispose()
      conn.errorSub?.dispose()
      conn.serverErrorSub?.dispose()
      try { conn.client.disconnect() } catch { /* already dead */ }
    }
    this.secondaries = []
    this.failedConnections = 0
    this.primaryConn?.rooms.clear()
  }

  /** Full teardown, including the primary's funnel listeners. Call on component cleanup. */
  dispose(): void {
    this.reset()
    this.primaryConn?.updateSub?.dispose()
    this.primaryConn?.errorSub?.dispose()
    this.primaryTokenSub?.dispose()
    this.primaryTokenSub = null
    this.primaryConn = null
    this.updateHandlers.clear()
    this.errorHandlers.clear()
  }
}
