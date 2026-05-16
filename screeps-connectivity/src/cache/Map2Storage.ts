import type { StorageAdapter } from '../storage/StorageAdapter.js'
import type { RoomMap2Data } from '../types/game.js'

interface CachedEntry {
  data: RoomMap2Data
  lastSeen: number    // wall-clock ms; meaningful across sessions
  lastAccess: number  // monotonic session sequence; used for in-memory LRU order
}

interface PersistedEntry {
  data: RoomMap2Data
  lastSeen: number
  lastAccess: number
}

export interface Map2StorageOptions {
  adapter: StorageAdapter | null
  namespace: string
  maxEntries: number
}

export class Map2Storage {
  private readonly memory = new Map<string, CachedEntry>()
  private readonly adapter: StorageAdapter | null
  private readonly maxEntries: number
  readonly namespace: string
  private accessSeq = 0

  constructor(opts: Map2StorageOptions) {
    this.adapter = opts.adapter
    this.maxEntries = opts.maxEntries
    this.namespace = opts.namespace
  }

  private key(room: string, shard: string | null): string {
    return `${shard ?? '_'}/${room}`
  }

  private adapterKey(k: string): string {
    return `map2/${k}`
  }

  private tick(): number { return ++this.accessSeq }

  private serialize(entry: CachedEntry): Uint8Array {
    const payload: PersistedEntry = { data: entry.data, lastSeen: entry.lastSeen, lastAccess: entry.lastAccess }
    return new TextEncoder().encode(JSON.stringify(payload))
  }

  private deserialize(bytes: Uint8Array): PersistedEntry | null {
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as PersistedEntry
    } catch {
      return null
    }
  }

  /** Synchronous read from memory only. Updates lastAccess on hit. */
  getMemory(room: string, shard: string | null): RoomMap2Data | null {
    const entry = this.memory.get(this.key(room, shard))
    if (!entry) return null
    entry.lastAccess = this.tick()
    return entry.data
  }

  /**
   * Async read: memory first, then IndexedDB fallback.
   * Hydrates memory on IndexedDB hit.
   */
  async get(room: string, shard: string | null): Promise<RoomMap2Data | null> {
    const memData = this.getMemory(room, shard)
    if (memData) return memData
    if (!this.adapter) return null

    const k = this.key(room, shard)
    const bytes = await this.adapter.get(this.adapterKey(k))
    if (!bytes) return null

    const persisted = this.deserialize(bytes)
    if (!persisted) return null

    this.memory.set(k, { data: persisted.data, lastSeen: persisted.lastSeen, lastAccess: this.tick() })
    return persisted.data
  }

  /**
   * Write to memory synchronously, then persist to IndexedDB.
   * Callers that don't need to await persistence: void this.put(...)
   */
  async put(room: string, shard: string | null, data: RoomMap2Data): Promise<void> {
    const k = this.key(room, shard)
    const entry: CachedEntry = { data, lastSeen: Date.now(), lastAccess: this.tick() }
    // Memory update is synchronous — happens before any await
    this.memory.set(k, entry)
    // Evict LRU entries (awaits adapter deletes so the full put() resolves after eviction)
    await this.pruneIfNeeded()
    if (this.adapter) {
      await this.adapter.set(this.adapterKey(k), this.serialize(entry))
    }
  }

  private async pruneIfNeeded(): Promise<void> {
    if (this.memory.size <= this.maxEntries) return
    const sorted = [...this.memory.entries()]
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess)
    const toEvict = sorted.slice(0, this.memory.size - this.maxEntries)
    for (const [k] of toEvict) {
      this.memory.delete(k)
      if (this.adapter) await this.adapter.delete(this.adapterKey(k))
    }
  }
}
