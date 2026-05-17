import { HttpClient } from './http/HttpClient.js'
import { SocketClient } from './socket/SocketClient.js'
import { Cache } from './cache/Cache.js'
import { RoomStore } from './stores/RoomStore.js'
import { UserStore } from './stores/UserStore.js'
import { ServerStore } from './stores/ServerStore.js'
import { MapStore } from './stores/MapStore.js'
import { MapStatsStore } from './stores/MapStatsStore.js'
import { NavigationStore } from './stores/NavigationStore.js'
import { Map2Storage } from './cache/Map2Storage.js'
import { Logger } from './logger.js'
import type { LogFn } from './logger.js'
import type { AuthStrategy } from './http/auth/AuthStrategy.js'
import type { StorageAdapter } from './storage/StorageAdapter.js'

type WsConstructor = typeof globalThis.WebSocket

export interface ScreepsClientOptions {
  url: string
  auth: AuthStrategy
  storage?: StorageAdapter | null
  WebSocket?: WsConstructor
  debug?: boolean | LogFn
  map2?: {
    maxSubscriptions?: number
    maxCacheEntries?: number
  }
}

export class ScreepsClient {
  readonly http: HttpClient
  readonly socket: SocketClient
  readonly stores: {
    readonly room: RoomStore
    readonly user: UserStore
    readonly server: ServerStore
    readonly map: MapStore
    readonly mapStats: MapStatsStore
    readonly navigation: NavigationStore
  }
  private readonly cache: Cache
  private readonly logger: Logger

  constructor(opts: ScreepsClientOptions) {
    let namespace: string
    try {
      namespace = new URL(opts.url).hostname
    } catch {
      throw new TypeError(`ScreepsClient: invalid url "${opts.url}"`)
    }
    this.logger = Logger.create(opts.debug)
    this.logger.log(`[screeps:client] init ${opts.url}`)
    this.cache = new Cache(namespace, opts.storage ?? null)
    this.http = new HttpClient({ url: opts.url, auth: opts.auth, logger: this.logger.child('http') })
    this.socket = new SocketClient({ url: opts.url, WebSocket: opts.WebSocket, logger: this.logger.child('socket') })
    const map2Storage = new Map2Storage({
      adapter: opts.storage ?? null,
      namespace,
      maxEntries: opts.map2?.maxCacheEntries ?? 10000,
    })
    this.stores = {
      room: new RoomStore(this.http, this.socket, this.cache, this.logger.child('room')),
      user: new UserStore(this.http, this.socket, this.cache, this.logger.child('user')),
      server: new ServerStore(this.http, this.socket, this.cache, this.logger.child('server')),
      map: new MapStore(this.socket, map2Storage, { maxSubscriptions: opts.map2?.maxSubscriptions ?? 500 }, this.logger.child('map')),
      mapStats: new MapStatsStore(this.http, 100, 500, this.logger.child('mapStats')),
      navigation: new NavigationStore(50, this.logger.child('navigation')),
    }
  }

  get isConnected(): boolean {
    return this.socket.isConnected
  }

  async connect(): Promise<void> {
    this.logger.log('[screeps:client] connect')
    await this.http.authenticate()
    await this.socket.connect(this.http.token!)
    await Promise.all([
      this.stores.user.me(),
      this.stores.server.version(),
    ])
  }

  disconnect(): void {
    this.logger.log('[screeps:client] disconnect')
    this.socket.disconnect()
  }

  async clearCache(): Promise<void> {
    this.logger.log('[screeps:client] clearCache')
    await this.cache.clearAll()
  }
}
