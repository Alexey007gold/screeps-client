import type {RoomStoreEvents, Subscription} from 'screeps-connectivity'
import {NullStorage, ScreepsClient, TokenAuth} from 'screeps-connectivity'

// Empirical screeps.com USER_LIMIT: full-object `room:` subscriptions are capped
// per WebSocket connection (see docs/project/Room Subscription Limit Investigation.md).
export const ROOMS_PER_CONNECTION = 2
// Number of dedicated connections opened for full-detail rooms — gives a
// 12-room ceiling on the official server. The primary app connection is never
// used for these subscriptions (see class doc), so this is purely additional
// connections on top of it.
export const MAX_POOL_CONNECTIONS = 6
// Private servers enforce the limit account-wide, so pooling doesn't help there —
// single (dedicated, non-primary) connection, fixed cap. Assumes the operator
// raised the server's USER_LIMIT to match; if not, the extra rooms simply show
// the server's own limit error.
export const PRIVATE_MAX_FULL_ROOMS = 12
// Delay before disconnecting an idle connection, so zoom/pan thrash (the same
// reason MultiRoomViewer debounces its reconcile) doesn't churn connect/auth.
export const KEEP_WARM_MS = 5000

// screeps.com load-balances connections across several backend processes, each
// independently enforcing ROOMS_PER_CONNECTION — confirmed by live testing
// (see docs/project/Room Subscription Limit Investigation.md). Two of our own
// pooled connections can randomly land on the SAME backend process, in which
// case their rooms start sharing that process's budget even though neither
// connection holds more than its own 2 rooms. A connection that keeps erroring
// is the observable symptom of that collision — reconnecting gives it a fresh
// random instance assignment, which usually escapes it.
export const CONTENTION_WINDOW = 10
export const CONTENTION_ERROR_THRESHOLD = 2
export const CONTENTION_RECONNECT_COOLDOWN_MS = 15_000

export type FullDetailUpdate = RoomStoreEvents['room:update']
export type FullDetailError = RoomStoreEvents['room:error']

interface PoolConnection {
  client: ScreepsClient
  state: 'connecting' | 'ready' | 'failed'
  connectPromise: Promise<void> | null
  rooms: Set<string>
  updateSub: Subscription | null
  errorSub: Subscription | null
  serverErrorSub: Subscription | null
  reapTimer: ReturnType<typeof setTimeout> | null
  // Ring buffer of this connection's last few room:update(true)/room:error(false)
  // outcomes, oldest first — capped at CONTENTION_WINDOW. Used to detect a
  // connection that landed on a contended backend instance (see CONTENTION_*).
  recentOutcomes: boolean[]
}

export interface FullDetailRoomCoordinatorOptions {
  /** Current primary app client, or null while disconnected. Used only as a
   *  token source for opening dedicated connections — never subscribed to
   *  rooms directly (see class doc). */
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
 * Owns the connection(s) backing the grid view's full-detail room subscriptions.
 *
 * The primary app connection is NEVER used for these subscriptions — it also
 * carries the user stream, map2 overlays, navigation and every other app
 * feature, and a connection that lands on a contended backend instance (see
 * CONTENTION_* below) needs to be disconnected and reconnected to recover.
 * Doing that to the primary would mean tearing down the user's actual login
 * session; doing it to a dedicated connection this coordinator opened itself
 * is cheap and invisible. So every full-detail room goes on a coordinator-owned
 * connection — 1 on private servers (pooling doesn't help there), up to
 * MAX_POOL_CONNECTIONS on the official server (where the limit is enforced
 * per-connection) — and the primary is only ever read for its auth token.
 */
export class FullDetailRoomCoordinator {
  private readonly opts: FullDetailRoomCoordinatorOptions
  private boundPrimary: ScreepsClient | null = null
  private primaryTokenSub: Subscription | null = null
  private connections: PoolConnection[] = []
  private failedConnections = 0
  private lastContentionReconnectAt = 0

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
    const poolable = this.opts.isPrivate() === false
    if (!poolable) return 1
    return Math.max(1, MAX_POOL_CONNECTIONS - this.failedConnections)
  }

  private perConnectionCap(): number {
    return this.opts.isPrivate() === false ? ROOMS_PER_CONNECTION : PRIVATE_MAX_FULL_ROOMS
  }

  capacity(): number {
    return this.perConnectionCap() * this.maxConnections()
  }

  private ensurePrimaryBound(): ScreepsClient | null {
    const primary = this.opts.getPrimary()
    if (!primary) return null
    if (this.boundPrimary === primary) return primary
    // Primary changed (fresh login/reconnect) or first use.
    this.primaryTokenSub?.dispose()
    this.boundPrimary = primary
    // A password/steam login's session token rotates (and expires on inactivity)
    // — dedicated connections snapshot it once at spin-up, so keep every live
    // one's stored token current in case it ever needs to reconnect later.
    // Harmless no-op for a durable personal API token (it never rotates).
    this.primaryTokenSub = primary.http.on('http:tokenRefresh', ({ token }) => {
      for (const s of this.connections) {
        s.client.http.setToken(token)
        s.client.socket.setToken(token)
      }
    })
    return primary
  }

  private attachFunnel(conn: PoolConnection): void {
    conn.updateSub = conn.client.stores.room.on('room:update', (data) => {
      this.recordOutcome(conn, true)
      for (const h of this.updateHandlers) h(data)
    })
    conn.errorSub = conn.client.stores.room.on('room:error', (data) => {
      this.recordOutcome(conn, false)
      for (const h of this.errorHandlers) h(data)
    })
    conn.serverErrorSub = conn.client.stores.server.on('server:error', () => {
      this.handleConnectionFailure(conn)
    })
  }

  private spinUpConnection(): PoolConnection {
    const primary = this.boundPrimary!
    const client = this.opts.createSecondary ? this.opts.createSecondary(primary) : defaultCreateSecondary(primary)
    const conn: PoolConnection = {
      client, state: 'connecting', connectPromise: null,
      rooms: new Set(), updateSub: null, errorSub: null, serverErrorSub: null, reapTimer: null,
      recentOutcomes: [],
    }
    this.connections.push(conn)
    conn.connectPromise = client.connect().then(
      () => {
        conn.state = 'ready'
        this.attachFunnel(conn)
      },
      () => {
        this.handleConnectionFailure(conn)
      },
    )
    return conn
  }

  // Disconnects a pooled connection and releases its listeners. Does not touch
  // `this.connections` or any rooms it was carrying — callers decide that part.
  private teardownConnection(conn: PoolConnection): void {
    if (conn.reapTimer !== null) { clearTimeout(conn.reapTimer); conn.reapTimer = null }
    conn.updateSub?.dispose()
    conn.errorSub?.dispose()
    conn.serverErrorSub?.dispose()
    try { conn.client.disconnect() } catch { /* already dead */ }
  }

  // Tears down a connection, removes it from the pool, and re-places every
  // room it was carrying (landing them on another connection with a free slot
  // or spinning up a fresh one).
  private retireConnection(conn: PoolConnection): void {
    this.teardownConnection(conn)
    this.connections = this.connections.filter((s) => s !== conn)

    const keys = [...conn.rooms]
    conn.rooms.clear()
    for (const key of keys) {
      if (this.roomToConn.get(key) === conn) this.roomToConn.delete(key)
      this.roomSubs.get(key)?.dispose()
      this.roomSubs.delete(key)
      this.replaceOne(key)
    }
  }

  private handleConnectionFailure(conn: PoolConnection): void {
    if (conn.state === 'failed') return
    conn.state = 'failed'
    this.failedConnections++
    this.retireConnection(conn)
  }

  private recordOutcome(conn: PoolConnection, success: boolean): void {
    conn.recentOutcomes.push(success)
    if (conn.recentOutcomes.length > CONTENTION_WINDOW) conn.recentOutcomes.shift()
    if (!success) this.maybeReconnectDueToContention(conn)
  }

  private maybeReconnectDueToContention(conn: PoolConnection): void {
    if (conn.recentOutcomes.length < CONTENTION_WINDOW) return
    const errors = conn.recentOutcomes.filter((ok) => !ok).length
    if (errors < CONTENTION_ERROR_THRESHOLD) return
    const now = Date.now()
    if (now - this.lastContentionReconnectAt < CONTENTION_RECONNECT_COOLDOWN_MS) return
    this.lastContentionReconnectAt = now
    this.reconnectDueToContention(conn)
  }

  // Tears down a connection that appears to have landed on a contended backend
  // instance and re-places its rooms — which, since this connection is removed
  // from the pool first, lands them on an existing connection with a free slot
  // or spins up a brand-new one with a fresh (hopefully uncontended) instance
  // assignment. Unlike handleConnectionFailure, this connection isn't actually
  // broken, so it does NOT count against failedConnections/capacity. Safe to do
  // freely because every connection here is one this coordinator opened itself
  // — never the primary.
  private reconnectDueToContention(conn: PoolConnection): void {
    if (conn.state === 'failed') return
    this.retireConnection(conn)
  }

  private replaceOne(key: string): void {
    const token = this.tokens.get(key)
    if (!token || token.cancelled) return
    void this.place(key, token)
  }

  private reserveConnection(key: string): PoolConnection | null {
    if (!this.ensurePrimaryBound()) return null

    const cap = this.perConnectionCap()
    const live = this.connections.filter((s) => s.state !== 'failed')
    for (const s of live) {
      if (s.rooms.size < cap) {
        if (s.reapTimer !== null) { clearTimeout(s.reapTimer); s.reapTimer = null }
        s.rooms.add(key)
        return s
      }
    }
    if (live.length < this.maxConnections()) {
      const fresh = this.spinUpConnection()
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
    if (conn.rooms.size > 0) return
    if (conn.reapTimer !== null) clearTimeout(conn.reapTimer)
    conn.reapTimer = setTimeout(() => {
      conn.reapTimer = null
      if (conn.rooms.size > 0) return
      this.connections = this.connections.filter((s) => s !== conn)
      this.teardownConnection(conn)
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
        const sub = this.roomSubs.get(key)
        const conn = this.roomToConn.get(key)
        sub?.dispose()
        this.roomSubs.delete(key)
        if (conn) {
          conn.rooms.delete(key)
          this.roomToConn.delete(key)
          this.armReap(conn)
        }
      },
    }
  }

  /** Funnels `room:update` from every dedicated connection through a single
   *  handler, mirroring the single-connection listener this replaces. */
  onRoomUpdate(handler: (data: FullDetailUpdate) => void): Subscription {
    this.updateHandlers.add(handler)
    return { dispose: () => { this.updateHandlers.delete(handler) } }
  }

  onRoomError(handler: (data: FullDetailError) => void): Subscription {
    this.errorHandlers.add(handler)
    return { dispose: () => { this.errorHandlers.delete(handler) } }
  }

  /** Drop all room subs and dedicated connections. Call on shard change. */
  reset(): void {
    for (const sub of this.roomSubs.values()) sub.dispose()
    this.roomSubs.clear()
    this.roomToConn.clear()
    this.tokens.clear()
    this.roomInfo.clear()
    for (const conn of this.connections) {
      this.teardownConnection(conn)
    }
    this.connections = []
    this.failedConnections = 0
    this.lastContentionReconnectAt = 0
  }

  /** Full teardown, including the primary token-refresh listener. Call on component cleanup. */
  dispose(): void {
    this.reset()
    this.primaryTokenSub?.dispose()
    this.primaryTokenSub = null
    this.boundPrimary = null
    this.updateHandlers.clear()
    this.errorHandlers.clear()
  }
}
