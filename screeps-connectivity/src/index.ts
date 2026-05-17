export { ScreepsClient } from './ScreepsClient.js'
export type { ScreepsClientOptions } from './ScreepsClient.js'

export { Logger } from './logger.js'
export type { LogFn } from './logger.js'

export { TokenAuth } from './http/auth/TokenAuth.js'
export { PasswordAuth } from './http/auth/PasswordAuth.js'
export { GuestAuth } from './http/auth/GuestAuth.js'
export type { AuthStrategy } from './http/auth/AuthStrategy.js'

export { IndexedDBStorage } from './storage/IndexedDBStorage.js'
export { NullStorage } from './storage/NullStorage.js'
export type { StorageAdapter } from './storage/StorageAdapter.js'

export { SubscriptionGroup } from './subscription/index.js'
export type { Subscription } from './subscription/index.js'

export { TerrainType, RoomTerrain } from './types/game.js'
export type {
  RoomObject,
  RoomObjectMap,
  RoomObjectDiff,
  RoomMap2Data,
  UserInfo,
  CpuStats,
  ConsoleMessage,
  ServerVersion,
  ShardInfo,
  WorldInfo,
  Badge,
  VisualStyle,
  RoomVisualEntry,
} from './types/game.js'

export { badgeToSvg } from './badge/index.js'
export type { BadgeSvgOptions } from './badge/index.js'
export type { RoomStoreEvents, UserStoreEvents, ServerStoreEvents, MapStoreEvents, Map2SubscriptionStatus } from './types/events.js'

export type { HttpClient, RateLimitInfo } from './http/HttpClient.js'
export type { SocketClient } from './socket/SocketClient.js'
export type { RoomStore } from './stores/RoomStore.js'
export type { UserStore } from './stores/UserStore.js'
export type { ServerStore } from './stores/ServerStore.js'
export type { MapStore, Map2Subscription, MapStoreOptions } from './stores/MapStore.js'
export type { NavigationStore, NavigationState, NavigationStoreEvents } from './stores/NavigationStore.js'
