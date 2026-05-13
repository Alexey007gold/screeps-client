import { TypedStore } from './TypedStore.js'
import type { Logger } from '../logger.js'
import type { ServerStoreEvents } from '../types/events.js'
import type { ServerVersion, ShardInfo } from '../types/game.js'
import type { HttpClient } from '../http/HttpClient.js'
import type { SocketClient } from '../socket/SocketClient.js'
import type { Cache } from '../cache/Cache.js'

export class ServerStore extends TypedStore<ServerStoreEvents> {
  private readonly http: HttpClient
  private readonly cache: Cache
  private _shards: ShardInfo[] | null = null
  get shardList(): ShardInfo[] | null { return this._shards }

  constructor(http: HttpClient, socket: SocketClient, cache: Cache, logger?: Logger) {
    super(logger)
    this.http = http
    this.cache = cache

    socket.on('connected', () => {
      this.emit('server:connected', {})
    })
    socket.on('disconnected', (data) => {
      const d = data as { willReconnect: boolean }
      this.emit('server:disconnected', { willReconnect: d.willReconnect })
    })
    socket.on('socket:error', (data) => {
      this.emit('server:error', { error: data instanceof Error ? data : new Error(String(data)) })
    })
  }

  async version(): Promise<ServerVersion> {
    const cached = this.cache.get<ServerVersion>('server/version')
    if (cached) return cached
    const res = await this.http.request<ServerVersion>('GET', '/api/version')
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
}
