import type { RoomObjectMap, RoomObjectDiff, RoomTerrain, RoomMap2Data, CpuStats, ConsoleMessage, UserInfo, ShardInfo, ServerVersion } from './game.js'
import type { MapStatsRoomData } from '../stores/MapStatsStore.js'

export interface RoomStoreEvents {
  'room:update': { room: string; shard: string | null; gameTime: number | undefined; objects: RoomObjectMap; diff: RoomObjectDiff; visual: string }
  'room:terrainavailable': { room: string; shard: string | null; terrain: RoomTerrain }
}

export type Map2SubscriptionStatus = 'pending' | 'active'

export interface MapStoreEvents {
  'room:map2update': { room: string; shard: string | null; data: RoomMap2Data; source: 'cache' | 'live' }
  'room:map2state': { room: string; shard: string | null; status: Map2SubscriptionStatus }
}

export interface UserStoreEvents {
  'user:me': UserInfo
  'user:cpu': CpuStats
  'user:console': { messages: ConsoleMessage }
  'user:code': { branch: string; modules: Record<string, string> }
}

export interface ServerStoreEvents {
  'server:connected': Record<string, never>
  'server:disconnected': { willReconnect: boolean }
  'server:error': { error: Error }
  'server:version': ServerVersion
  'server:shards': ShardInfo[]
}

export interface MapStatsStoreEvents {
  'mapStats:room': { room: string; shard: string | null; stat: MapStatsRoomData }
}
