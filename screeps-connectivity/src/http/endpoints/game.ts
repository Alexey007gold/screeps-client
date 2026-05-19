import type { HttpClient } from '../HttpClient.js'
import type { ApiRoomTerrainResponse, ApiRoomObjectsResponse, ApiShardsInfoResponse, ApiMapStatsResponse, ApiGameRoomsResponse, ApiCreateFlagResponse, ApiGenUniqueFlagNameResponse, ApiCheckUniqueFlagNameResponse, ApiChangeFlagColorResponse, ApiRemoveFlagResponse } from '../../types/api.js'

export interface GameEndpoints {
  roomTerrain(room: string, shard?: string | null): Promise<ApiRoomTerrainResponse>
  /** @deprecated Not available on private servers (backend-local). Room objects are delivered via the `room:<name>` WebSocket channel. */
  roomObjects(room: string, shard?: string | null): Promise<ApiRoomObjectsResponse>
  roomStatus(room: string, shard?: string | null): Promise<{ ok: number; status: string; novice?: string }>
  roomOverview(room: string, interval?: number, shard?: string | null): Promise<unknown>
  time(shard?: string | null): Promise<{ ok: number; time: number }>
  worldSize(shard?: string | null): Promise<unknown>
  mapStats(rooms: string[], statName: string, shard?: string | null): Promise<ApiMapStatsResponse>
  roomsTerrain(rooms: string[], shard?: string | null): Promise<ApiGameRoomsResponse>
  createFlag(room: string, x: number, y: number, name: string, color: number, secondaryColor: number, shard?: string | null): Promise<ApiCreateFlagResponse>
  genUniqueFlagName(): Promise<ApiGenUniqueFlagNameResponse>
  checkUniqueFlagName(name: string): Promise<ApiCheckUniqueFlagNameResponse>
  changeFlagColor(room: string, name: string, color: number, secondaryColor: number): Promise<ApiChangeFlagColorResponse>
  removeFlag(room: string, name: string): Promise<ApiRemoveFlagResponse>
  market: {
    ordersIndex(shard?: string | null): Promise<unknown>
    myOrders(): Promise<unknown>
    orders(resourceType: string, shard?: string | null): Promise<unknown>
    stats(resourceType: string, shard?: string | null): Promise<unknown>
  }
  shards: {
    info(): Promise<ApiShardsInfoResponse>
  }
}

function withShard(params: Record<string, unknown>, shard?: string | null): Record<string, unknown> {
  if (shard) params.shard = shard
  return params
}

export function createGameEndpoints(http: HttpClient): GameEndpoints {
  return {
    roomTerrain: (room, shard) => http.request('GET', '/api/game/room-terrain', withShard({ room, encoded: 1 }, shard)),
    roomObjects: (room, shard) => http.request('GET', '/api/game/room-objects', withShard({ room }, shard)),
    roomStatus: (room, shard) => http.request('GET', '/api/game/room-status', withShard({ room }, shard)),
    roomOverview: (room, interval = 8, shard) => http.request('GET', '/api/game/room-overview', withShard({ room, interval }, shard)),
    time: (shard) => http.request('GET', '/api/game/time', withShard({}, shard)),
    worldSize: (shard) => http.request('GET', '/api/game/world-size', withShard({}, shard)),
    mapStats: (rooms, statName, shard) => http.request('POST', '/api/game/map-stats', withShard({ rooms, statName }, shard)),
    roomsTerrain: (rooms, shard) => {
      const params = new URLSearchParams({ encoded: 'true' })
      if (shard) params.set('shard', shard)
      return http.request('POST', `/api/game/rooms?${params}`, { rooms })
    },
    createFlag: (room, x, y, name, color, secondaryColor, shard) => http.request('POST', '/api/game/create-flag', withShard({ room, x, y, name, color, secondaryColor }, shard)),
    genUniqueFlagName: () => http.request('POST', '/api/game/gen-unique-flag-name'),
    checkUniqueFlagName: (name) => http.request('POST', '/api/game/check-unique-flag-name', { name }),
    changeFlagColor: (room, name, color, secondaryColor) => http.request('POST', '/api/game/change-flag-color', { room, name, color, secondaryColor }),
    removeFlag: (room, name) => http.request('POST', '/api/game/remove-flag', { room, name }),
    market: {
      ordersIndex: (shard) => http.request('GET', '/api/game/market/orders-index', withShard({}, shard)),
      myOrders: () => http.request('GET', '/api/game/market/my-orders'),
      orders: (resourceType, shard) => http.request('GET', '/api/game/market/orders', withShard({ resourceType }, shard)),
      stats: (resourceType, shard) => http.request('GET', '/api/game/market/stats', withShard({ resourceType }, shard)),
    },
    shards: {
      info: () => http.request('GET', '/api/game/shards/info'),
    },
  }
}
