import type { HttpClient } from '../HttpClient.js'
import type { ApiUserBranchesResponse } from '../../types/api.js'

export interface UserEndpoints {
  branches(): Promise<ApiUserBranchesResponse>
  code: {
    get(branch: string): Promise<unknown>
    set(branch: string, modules: Record<string, string>): Promise<unknown>
  }
  memory: {
    get(path: string, shard?: string | null): Promise<{ ok: number; data: unknown }>
    set(path: string, value: unknown, shard?: string | null): Promise<unknown>
    segment: {
      get(segment: number, shard?: string | null): Promise<{ ok: number; data: string }>
      set(segment: number, data: string, shard?: string | null): Promise<unknown>
    }
  }
  console(expression: string, shard?: string | null): Promise<unknown>
  stats(interval: number): Promise<unknown>
  rooms(id: string): Promise<unknown>
  overview(interval: number, statName: string): Promise<unknown>
  worldStatus(): Promise<{ ok: number; status: 'normal' | 'lost' | 'empty' }>
  worldStartRoom(shard?: string | null): Promise<unknown>
}

function withShard(params: Record<string, unknown>, shard?: string | null): Record<string, unknown> {
  if (shard) params.shard = shard
  return params
}

export function createUserEndpoints(http: HttpClient): UserEndpoints {
  return {
    branches: () => http.request('GET', '/api/user/branches'),
    code: {
      get: (branch) => http.request('GET', '/api/user/code', { branch }),
      set: (branch, modules) => http.request('POST', '/api/user/code', { branch, modules, _hash: Date.now() }),
    },
    memory: {
      get: (path, shard) => http.request('GET', '/api/user/memory', withShard({ path }, shard)),
      set: (path, value, shard) => http.request('POST', '/api/user/memory', withShard({ path, value }, shard)),
      segment: {
        get: (segment, shard) => http.request('GET', '/api/user/memory-segment', withShard({ segment }, shard)),
        set: (segment, data, shard) => http.request('POST', '/api/user/memory-segment', withShard({ segment, data }, shard)),
      },
    },
    console: (expression, shard) => http.request('POST', '/api/user/console', withShard({ expression }, shard)),
    stats: (interval) => http.request('GET', '/api/user/stats', { interval }),
    rooms: (id) => http.request('GET', '/api/user/rooms', { id }),
    overview: (interval, statName) => http.request('GET', '/api/user/overview', { interval, statName }),
    worldStatus: () => http.request('GET', '/api/user/world-status'),
    worldStartRoom: (shard) => http.request('GET', '/api/user/world-start-room', withShard({}, shard)),
  }
}
