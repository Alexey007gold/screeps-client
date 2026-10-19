import { TypedStore } from './TypedStore.js'
import type { Logger } from '../logger.js'
import type { ServerStoreEvents } from '../types/events.js'
import type { ServerVersion, ShardInfo, WorldInfo } from '../types/game.js'
import type { HttpClient } from '../http/HttpClient.js'
import type { SocketClient } from '../socket/SocketClient.js'
import type { Cache } from '../cache/Cache.js'
import type { Subscription } from '../subscription/index.js'

function roomNameAt(x: number, y: number): string {
  return `${x < 0 ? `W${-x - 1}` : `E${x}`}${y < 0 ? `N${-y - 1}` : `S${y}`}`
}

function roomCoordOf(name: string): [number, number] | null {
  const m = name.match(/^([WE])(\d+)([NS])(\d+)$/)
  if (!m) return null
  const x = m[1] === 'W' ? -Number(m[2]) - 1 : Number(m[2])
  const y = m[3] === 'N' ? -Number(m[4]) - 1 : Number(m[4])
  return [x, y]
}

export class ServerStore extends TypedStore<ServerStoreEvents> {
  private readonly http: HttpClient
  private readonly cache: Cache
  private readonly socketSubs: Subscription[] = []
  private _version: ServerVersion | null = null
  get versionInfo(): ServerVersion | null { return this._version }
  get isPrivateServer(): boolean | null {
    if (!this._version) return null
    return (this._version.serverData?.shards?.length ?? 0) === 0
  }
  private _shards: ShardInfo[] | null = null
  get shardList(): ShardInfo[] | null { return this._shards }

  private readonly exactWorldBounds: boolean

  constructor(http: HttpClient, socket: SocketClient, cache: Cache, logger?: Logger, opts?: { exactWorldBounds?: boolean }) {
    super(logger)
    this.http = http
    this.cache = cache
    this.exactWorldBounds = opts?.exactWorldBounds ?? false

    this.socketSubs.push(socket.on('connected', () => {
      this.emit('server:connected', {})
    }))
    this.socketSubs.push(socket.on('disconnected', (data) => {
      const d = data as { willReconnect: boolean; intentional?: boolean }
      this.emit('server:disconnected', { willReconnect: d.willReconnect, intentional: d.intentional ?? false })
    }))
    this.socketSubs.push(socket.on('socket:error', (data) => {
      this.emit('server:error', { error: data instanceof Error ? data : new Error(String(data)) })
    }))
  }

  /** Release socket listeners owned by this store. Idempotent. */
  destroy(): void {
    for (const sub of this.socketSubs) sub.dispose()
    this.socketSubs.length = 0
  }

  /**
   * Seed the server version without a network request. Used when the version is
   * already known at construction time — e.g. an embedded client whose host mod
   * inlines the `/api/version` payload into the page, sparing the initial fetch.
   * Does not emit `server:version` (listeners aren't attached yet at that point);
   * the value surfaces via the cache-hit path on the first `version()` call.
   */
  seedVersion(version: ServerVersion): void {
    this._version = version
    this.cache.set('server/version', version, 5 * 60_000)
  }

  async version(): Promise<ServerVersion> {
    const cached = this.cache.get<ServerVersion>('server/version')
    if (cached) {
      // Emit on cache hits too so a seeded version (see `seedVersion`) reaches
      // listeners that only attach after construction. Idempotent for consumers.
      this._version = cached
      this.emit('server:version', cached)
      return cached
    }
    const res = await this.http.request<ServerVersion>('GET', '/api/version')
    this._version = res
    this.cache.set('server/version', res, 5 * 60_000)
    this.emit('server:version', res)
    return res
  }

  async refreshVersion(): Promise<ServerVersion> {
    this.cache.delete('server/version')
    return this.version()
  }

  async shards(): Promise<ShardInfo[]> {
    const cached = this.cache.get<ShardInfo[]>('server/shards')
    if (cached) return cached
    const res = await this.http.request<{ ok: number; shards: ShardInfo[] }>('GET', '/api/game/shards/info')
    this._shards = res.shards
    this.cache.set('server/shards', res.shards, 5 * 60_000)
    this.emit('server:shards', res.shards)
    return res.shards
  }

  async refreshShards(): Promise<ShardInfo[]> {
    this.cache.delete('server/shards')
    return this.shards()
  }

  async worldInfo(shard?: string): Promise<WorldInfo> {
    const shardKey = shard ?? 'default'
    const cacheKey = `server/world/${shardKey}`
    const cached = this.cache.get<WorldInfo>(cacheKey)
    if (cached) return cached

    const params: Record<string, string> = {}
    if (shard) params.shard = shard

    const size = await this.http.request<{ ok: number; width: number; height: number }>(
      'GET', '/api/game/world-size', params
    )
    const { width, height } = size
    this.logger.log(`worldInfo shard=${shard ?? 'none'} — raw size: ${width}x${height}`)

    // Start with W/N-only assumption (most common for private servers)
    // width/height = total rooms in that axis; W-only → all rooms are west of E0
    let minX = -width, maxX = -1, minY = -height, maxY = -1

    // Probe the four quadrant-origin rooms to detect which quadrants actually exist.
    // mapStats only returns entries for rooms that exist on the server.
    try {
      const probe = await this.http.request<{ ok: number; stats: Record<string, unknown> }>(
        'POST', '/api/game/map-stats',
        { rooms: ['W0N0', 'E0N0', 'W0S0', 'E0S0'], statName: 'owner0', ...params }
      )
      const stats = probe.stats ?? {}
      const found = (['W0N0', 'E0N0', 'W0S0', 'E0S0'] as const).filter(r => r in stats)
      this.logger.log(`worldInfo corner probe — found: [${found.length ? found.join(', ') : 'none'}]`)
      const hasEast  = 'E0N0' in stats || 'E0S0' in stats
      const hasWest  = 'W0N0' in stats || 'W0S0' in stats
      const hasSouth = 'W0S0' in stats || 'E0S0' in stats
      const hasNorth = 'W0N0' in stats || 'E0N0' in stats
      if (hasEast && hasWest) {
        // Both E and W quadrants exist: split width evenly around E0/W0
        minX = -Math.ceil(width / 2)
        maxX = Math.floor(width / 2) - 1
      } else if (hasEast) {
        // Only E quadrant: all rooms are east of E0
        minX = 0
        maxX = width - 1
      }
      // else: W-only keeps default (minX=-width, maxX=-1)
      if (hasSouth && hasNorth) {
        // Both S and N quadrants exist: split height evenly around S0/N0
        minY = -Math.ceil(height / 2)
        maxY = Math.floor(height / 2) - 1
      } else if (hasSouth) {
        // Only S quadrant: all rooms are south of S0
        minY = 0
        maxY = height - 1
      }
      // else: N-only keeps default (minY=-height, maxY=-1)
    } catch (e) {
      this.logger.log('worldInfo corner probe failed — keeping W/N defaults:', e)
    }

    if (this.exactWorldBounds) {
      const exact = await this.scanWorldBounds(width, height, params)
      if (exact) ({ minX, maxX, minY, maxY } = exact)
    }

    this.logger.log(`worldInfo computed bounds — x: [${minX}, ${maxX}]  y: [${minY}, ${maxY}]`)
    const info: WorldInfo = { shard: shard ?? null, width, height, minX, maxX, minY, maxY }
    this.cache.set(cacheKey, info, 10 * 60_000)
    return info
  }

  private async scanWorldBounds(width: number, height: number, params: Record<string, string>):
    Promise<Pick<WorldInfo, 'minX' | 'maxX' | 'minY' | 'maxY'> | null> {
    const rooms: string[] = []
    for (let x = -width; x < width; x++) {
      for (let y = -height; y < height; y++) rooms.push(roomNameAt(x, y))
    }
    try {
      const res = await this.http.request<{ ok: number; stats: Record<string, unknown> }>(
        'POST', '/api/game/map-stats', { rooms, statName: 'owner0', ...params }
      )
      const coords = Object.keys(res.stats ?? {}).map(roomCoordOf).filter((c): c is [number, number] => !!c)
      this.logger.log(`worldInfo room scan — ${coords.length} of ${rooms.length} rooms exist`)
      if (!coords.length) return null
      const xs = coords.map(([x]) => x)
      const ys = coords.map(([, y]) => y)
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
    } catch (e) {
      this.logger.log('worldInfo room scan failed — keeping probed bounds:', e)
      return null
    }
  }

  invalidateWorldInfo(shard?: string): void {
    this.cache.delete(`server/world/${shard ?? 'default'}`)
  }
}
