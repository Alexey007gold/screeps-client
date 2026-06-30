import type { ApiUserRoomsResponse } from 'screeps-connectivity'

export interface OwnedRoom {
  room: string
  shard: string | null
}

// The rooms endpoint shape varies by server: multishard keys rooms by shard,
// single-shard may return a flat list. Normalize both to {room, shard}. Shared
// by the Overview (self) and Profile (public) owned-room minimap grids.
export function extractOwnedRooms(res: ApiUserRoomsResponse): OwnedRoom[] {
  if (res.shards) {
    return Object.entries(res.shards).flatMap(([shard, list]) =>
      (list ?? []).map((room) => ({ room, shard })))
  }
  return (res.rooms ?? []).map((room) => ({ room, shard: null }))
}
