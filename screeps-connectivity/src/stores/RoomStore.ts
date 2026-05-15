import { TypedStore } from './TypedStore.js'
import { RoomTerrain } from '../types/game.js'
import type { Logger } from '../logger.js'
import type { RoomStoreEvents } from '../types/events.js'
import type { RoomObject, RoomObjectMap, RoomObjectDiff } from '../types/game.js'
import type { HttpClient } from '../http/HttpClient.js'
import type { SocketClient } from '../socket/SocketClient.js'
import type { Cache } from '../cache/Cache.js'
import type { Subscription } from '../subscription/index.js'

export class RoomStore extends TypedStore<RoomStoreEvents> {
  private readonly http: HttpClient
  private readonly socket: SocketClient
  private readonly cache: Cache
  private readonly roomObjects = new Map<string, RoomObjectMap>()
  private readonly roomSubCount = new Map<string, number>()

  constructor(http: HttpClient, socket: SocketClient, cache: Cache, logger?: Logger) {
    super(logger)
    this.http = http
    this.socket = socket
    this.cache = cache
  }

  async terrain(room: string, shard: string | null): Promise<RoomTerrain> {
    const key = `terrain/${shard}/${room}`

    const cached = this.cache.get<RoomTerrain>(key)
    if (cached) {
      this.logger.log('terrain', room, shard, '(memory cache hit)')
      return cached
    }

    const persisted = await this.cache.getPersistent(key)
    if (persisted) {
      this.logger.log('terrain', room, shard, '(persistent cache hit)')
      const terrain = new RoomTerrain(persisted)
      this.cache.set(key, terrain)
      return terrain
    }

    this.logger.log('terrain', room, shard, '(fetching)')
    const res = await this.http.game.roomTerrain(room, shard ?? undefined)
    const entry = res.terrain[0]
    if (!entry) throw new Error(`No terrain data for room ${room} shard ${shard}`)
    const terrain = RoomTerrain.fromEncodedString(entry.terrain)

    this.cache.set(key, terrain)
    await this.cache.setPersistent(key, terrain.raw)
    this.emit('room:terrainavailable', { room, shard, terrain })

    return terrain
  }

  async terrainBulk(rooms: string[], shard: string | null): Promise<Map<string, RoomTerrain>> {
    const result = new Map<string, RoomTerrain>()
    const needPersistentCheck: string[] = []

    for (const room of rooms) {
      const cached = this.cache.get<RoomTerrain>(`terrain/${shard}/${room}`)
      if (cached) {
        result.set(room, cached)
      } else {
        needPersistentCheck.push(room)
      }
    }

    if (needPersistentCheck.length === 0) return result

    const needFetch: string[] = []
    await Promise.all(needPersistentCheck.map(async (room) => {
      const key = `terrain/${shard}/${room}`
      const persisted = await this.cache.getPersistent(key)
      if (persisted) {
        const terrain = new RoomTerrain(persisted)
        this.cache.set(key, terrain)
        result.set(room, terrain)
      } else {
        needFetch.push(room)
      }
    }))

    if (needFetch.length === 0) return result

    this.logger.log('terrainBulk', `fetching ${needFetch.length} rooms`, shard)
    const res = await this.http.game.roomsTerrain(needFetch, shard ?? undefined)

    await Promise.all(res.rooms.map(async (entry) => {
      const terrain = RoomTerrain.fromEncodedString(entry.terrain)
      const key = `terrain/${shard}/${entry.room}`
      this.cache.set(key, terrain)
      await this.cache.setPersistent(key, terrain.raw)
      this.emit('room:terrainavailable', { room: entry.room, shard, terrain })
      result.set(entry.room, terrain)
    }))

    return result
  }

  objects(room: string, shard: string | null): RoomObjectMap | null {
    return this.roomObjects.get(`${room}/${shard}`) ?? null
  }

  /** @deprecated Room objects are delivered via WebSocket on subscription. This endpoint is not supported by all servers and is not needed. */
  async fetchObjects(room: string, shard: string | null): Promise<void> {
    const mapKey = `${room}/${shard}`
    const res = await this.http.game.roomObjects(room, shard ?? undefined)
    const map: RoomObjectMap = {}
    for (const obj of res.objects as RoomObject[]) {
      if (obj && typeof obj === 'object' && '_id' in obj) {
        map[(obj as RoomObject)._id] = obj as RoomObject
      }
    }
    this.roomObjects.set(mapKey, map)
    this.emit('room:update', { room, shard, gameTime: undefined, objects: map, diff: map, visual: '' })
  }

  subscribe(room: string, shard: string | null): Subscription {
    const mapKey = `${room}/${shard}`
    const count = this.roomSubCount.get(mapKey) ?? 0
    this.roomSubCount.set(mapKey, count + 1)
    this.logger.log('subscribe', room, shard, `(refs: ${count + 1})`)

    const channel = shard ? `room:${shard}/${room}` : `room:${room}`
    const socketSub = this.socket.subscribe(channel)

    const listenerSub = this.socket.on(channel, (data) => {
      const update = data as { objects: RoomObjectDiff; gameTime?: number; visual?: string }
      const current: RoomObjectMap = { ...(this.roomObjects.get(mapKey) ?? {}) }

      for (const [id, obj] of Object.entries(update.objects)) {
        if (obj === null) {
          delete current[id]
        } else if (current[id]) {
          current[id] = { ...current[id], ...obj } as RoomObject
        } else {
          current[id] = obj as RoomObject
        }
      }

      this.roomObjects.set(mapKey, current)
      this.emit('room:update', { room, shard, gameTime: update.gameTime, objects: current, diff: update.objects, visual: update.visual ?? '' })
    })

    return {
      dispose: () => {
        socketSub.dispose()
        listenerSub.dispose()
        const remaining = (this.roomSubCount.get(mapKey) ?? 1) - 1
        if (remaining <= 0) {
          this.logger.log('unsubscribe', room, shard, '(last ref)')
          this.roomSubCount.delete(mapKey)
          this.roomObjects.delete(mapKey)
        } else {
          this.logger.log('unsubscribe', room, shard, `(refs: ${remaining})`)
          this.roomSubCount.set(mapKey, remaining)
        }
      },
    }
  }
}
