import type { HttpClient } from './HttpClient.js'
import type { ApiMapStatsResponse, ApiMapStatsRoomStat } from '../types/api.js'

interface PendingCall {
  rooms: string[]
  resolve: (value: ApiMapStatsResponse) => void
  reject: (reason: unknown) => void
}

interface BatchEntry {
  rooms: Set<string>
  calls: PendingCall[]
}

export class MapStatsBatcher {
  private readonly http: HttpClient
  private readonly debounceMs: number
  private pending = new Map<string, BatchEntry>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(http: HttpClient, debounceMs = 5) {
    this.http = http
    this.debounceMs = debounceMs
  }

  mapStats(rooms: string[], statName: string, shard?: string): Promise<ApiMapStatsResponse> {
    if (rooms.length === 0) {
      return Promise.resolve({ ok: 1, stats: {}, users: {} })
    }

    return new Promise((resolve, reject) => {
      const key = JSON.stringify([statName, shard ?? 'shard0'])
      let entry = this.pending.get(key)
      if (!entry) {
        entry = { rooms: new Set(), calls: [] }
        this.pending.set(key, entry)
      }
      for (const room of rooms) entry.rooms.add(room)
      entry.calls.push({ rooms, resolve, reject })

      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => this.flush(), this.debounceMs)
    })
  }

  private async flush(): Promise<void> {
    const toFlush = new Map(this.pending)
    this.pending.clear()
    this.timer = null

    for (const [key, entry] of toFlush) {
      const [statName, shard] = JSON.parse(key) as [string, string]
      const allRooms = [...entry.rooms]

      try {
        const res = await this.http.request<ApiMapStatsResponse>('POST', '/api/game/map-stats', {
          rooms: allRooms,
          statName,
          shard,
        })

        for (const call of entry.calls) {
          const filteredStats: Record<string, ApiMapStatsRoomStat> = {}
          for (const room of call.rooms) {
            if (room in res.stats) {
              filteredStats[room] = res.stats[room]
            }
          }
          call.resolve({ ok: res.ok, stats: filteredStats, users: res.users })
        }
      } catch (err) {
        for (const call of entry.calls) {
          call.reject(err)
        }
      }
    }
  }
}
