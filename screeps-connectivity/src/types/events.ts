import type { RoomObjectMap, RoomTerrain, CpuStats, ConsoleMessage, UserInfo, ShardInfo, ServerVersion } from './game.js'

export interface RoomStoreEvents {
  'room:update': { room: string; shard: string | null; gameTime: number | undefined; objects: RoomObjectMap }
  'room:terrainavailable': { room: string; shard: string | null; terrain: RoomTerrain }
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
