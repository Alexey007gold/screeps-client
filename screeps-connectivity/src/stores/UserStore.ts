import { TypedStore } from './TypedStore.js'
import type { Logger } from '../logger.js'
import type { UserStoreEvents } from '../types/events.js'
import type { UserInfo, CpuStats, ConsoleMessage } from '../types/game.js'
import type { HttpClient } from '../http/HttpClient.js'
import type { SocketClient } from '../socket/SocketClient.js'
import type { Cache } from '../cache/Cache.js'
import type { Subscription } from '../subscription/index.js'

export class UserStore extends TypedStore<UserStoreEvents> {
  private readonly http: HttpClient
  private readonly socket: SocketClient
  private readonly cache: Cache
  readonly console: ConsoleMessage[] = []
  readonly maxConsoleSize: number
  private _cpu: CpuStats | null = null
  get cpu(): CpuStats | null { return this._cpu }
  private _userInfo: UserInfo | null = null
  get userInfo(): UserInfo | null { return this._userInfo }
  private _userId: string | null = null
  get userId(): string | null { return this._userId }

  constructor(http: HttpClient, socket: SocketClient, cache: Cache, logger?: Logger, maxConsoleSize = 100) {
    super(logger)
    this.http = http
    this.socket = socket
    this.cache = cache
    this.maxConsoleSize = maxConsoleSize
  }

  async me(): Promise<UserInfo> {
    const cached = this.cache.get<UserInfo>('user/me')
    if (cached) return cached
    this.logger.log('fetch me')
    const res = await this.http.auth.me()
    const user = res as unknown as UserInfo
    this._userId = user._id
    this._userInfo = user
    this.cache.set('user/me', user, 60_000)
    this.emit('user:me', user)
    return user
  }

  async refreshMe(): Promise<UserInfo> {
    this.logger.log('refresh me')
    this.cache.delete('user/me')
    return this.me()
  }

  subscribe(channel: 'console' | 'cpu' | 'code'): Subscription {
    this.logger.log('subscribe', channel)
    let socketSub: Subscription | null = null
    let listenerSub: Subscription | null = null
    let disposed = false

    const setup = async () => {
      try {
        const uid = this._userId ?? (await this.me())._id
        if (disposed) return
        const fullChannel = `user:${uid}/${channel}`
        socketSub = this.socket.subscribe(fullChannel)
        listenerSub = this.socket.on(fullChannel, (data) => {
          if (channel === 'cpu') {
            this._cpu = data as CpuStats
            this.emit('user:cpu', this._cpu)
          } else if (channel === 'console') {
            const raw = data as { messages?: ConsoleMessage, error?: string }
            const msg: ConsoleMessage = {
              log: raw.messages?.log ?? [],
              results: raw.messages?.results ?? [],
              error: raw.messages?.error ?? [],
            }
            if (raw.error) {
              msg.error.push(raw.error)
            }
            this.console.push(msg)
            if (this.console.length > this.maxConsoleSize) {
              this.console.splice(0, this.console.length - this.maxConsoleSize)
            }
            this.emit('user:console', { messages: msg })
          } else if (channel === 'code') {
            this.emit('user:code', data as { branch: string; modules: Record<string, string> })
          }
        })
      } catch (err) {
        if (!disposed) {
          this.dispatchEvent(new ErrorEvent('error', { error: err instanceof Error ? err : new Error(String(err)) }))
        }
      }
    }

    void setup()

    return {
      dispose: () => {
        this.logger.log('unsubscribe', channel)
        disposed = true
        socketSub?.dispose()
        listenerSub?.dispose()
      },
    }
  }
}
