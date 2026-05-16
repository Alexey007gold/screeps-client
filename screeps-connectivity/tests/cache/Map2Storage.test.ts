import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IndexedDBStorage } from '../../src/storage/IndexedDBStorage.js'
import { Map2Storage } from '../../src/cache/Map2Storage.js'
import type { RoomMap2Data } from '../../src/types/game.js'

const DATA_A: RoomMap2Data = { s: [[10, 20]], c: [[25, 25]] }
const DATA_B: RoomMap2Data = { m: [[30, 30]] }

function makeStorage(maxEntries = 100) {
  const adapter = new IndexedDBStorage(`map2-test-${Math.random()}`)
  const storage = new Map2Storage({ adapter, namespace: 'test.local', maxEntries })
  return storage
}

describe('Map2Storage — memory path', () => {
  it('getMemory() returns null when entry not yet loaded', () => {
    const storage = makeStorage()
    expect(storage.getMemory('W7N7', 'shard0')).toBeNull()
  })

  it('get() returns null when adapter has no entry', async () => {
    const storage = makeStorage()
    expect(await storage.get('W7N7', 'shard0')).toBeNull()
  })

  it('put() makes data immediately available via getMemory()', async () => {
    const storage = makeStorage()
    void storage.put('W7N7', 'shard0', DATA_A)  // don't await — memory is sync
    expect(storage.getMemory('W7N7', 'shard0')).toEqual(DATA_A)
  })
})

describe('Map2Storage — IndexedDB persistence', () => {
  it('put() persists data; get() retrieves it after memory is cold', async () => {
    const adapter = new IndexedDBStorage(`map2-test-${Math.random()}`)
    const storage1 = new Map2Storage({ adapter, namespace: 'test.local', maxEntries: 100 })
    await storage1.put('W7N7', 'shard0', DATA_A)

    // Simulate cold start: fresh storage instance sharing the same adapter
    const storage2 = new Map2Storage({ adapter, namespace: 'test.local', maxEntries: 100 })
    const result = await storage2.get('W7N7', 'shard0')
    expect(result).toEqual(DATA_A)
  })

  it('get() hydrates memory from IndexedDB on hit', async () => {
    const adapter = new IndexedDBStorage(`map2-test-${Math.random()}`)
    const storage1 = new Map2Storage({ adapter, namespace: 'test.local', maxEntries: 100 })
    await storage1.put('W7N7', 'shard0', DATA_A)

    const storage2 = new Map2Storage({ adapter, namespace: 'test.local', maxEntries: 100 })
    await storage2.get('W7N7', 'shard0')
    // After hydration, getMemory() must return the data synchronously
    expect(storage2.getMemory('W7N7', 'shard0')).toEqual(DATA_A)
  })

  it('put() with null shard stores under _ namespace', async () => {
    const adapter = new IndexedDBStorage(`map2-test-${Math.random()}`)
    const storage1 = new Map2Storage({ adapter, namespace: 'test.local', maxEntries: 100 })
    await storage1.put('E9N3', null, DATA_B)

    const storage2 = new Map2Storage({ adapter, namespace: 'test.local', maxEntries: 100 })
    expect(await storage2.get('E9N3', null)).toEqual(DATA_B)
    expect(await storage2.get('E9N3', 'shard0')).toBeNull()
  })

  it('different Map2Storage instances with different adapters do not share data', async () => {
    const adapter1 = new IndexedDBStorage(`map2-test-${Math.random()}`)
    const adapter2 = new IndexedDBStorage(`map2-test-${Math.random()}`)
    const s1 = new Map2Storage({ adapter: adapter1, namespace: 'a', maxEntries: 100 })
    const s2 = new Map2Storage({ adapter: adapter2, namespace: 'b', maxEntries: 100 })

    await s1.put('W7N7', 'shard0', DATA_A)
    expect(await s2.get('W7N7', 'shard0')).toBeNull()
  })
})

describe('Map2Storage — LRU eviction with IndexedDB', () => {
  it('evicts LRU entry from both memory and IndexedDB when over maxEntries', async () => {
    const adapter = new IndexedDBStorage(`map2-test-${Math.random()}`)
    const storage = new Map2Storage({ adapter, namespace: 'test.local', maxEntries: 2 })

    await storage.put('W1N1', null, DATA_A)
    await storage.put('W2N2', null, DATA_A)
    storage.getMemory('W1N1', null)           // touch W1N1 → W2N2 becomes oldest
    await storage.put('W3N3', null, DATA_A)   // triggers eviction of W2N2

    // Memory check
    expect(storage.getMemory('W1N1', null)).not.toBeNull()
    expect(storage.getMemory('W2N2', null)).toBeNull()
    expect(storage.getMemory('W3N3', null)).not.toBeNull()

    // IndexedDB check via a cold storage instance
    const cold = new Map2Storage({ adapter, namespace: 'test.local', maxEntries: 100 })
    expect(await cold.get('W1N1', null)).toEqual(DATA_A)
    expect(await cold.get('W2N2', null)).toBeNull()
    expect(await cold.get('W3N3', null)).toEqual(DATA_A)
  })

  it('memory-only eviction still works when adapter is null', async () => {
    const storage = new Map2Storage({ adapter: null, namespace: 'test.local', maxEntries: 2 })
    const data: RoomMap2Data = {}

    void storage.put('W1N1', null, data)
    void storage.put('W2N2', null, data)
    storage.getMemory('W1N1', null)   // touch W1N1
    void storage.put('W3N3', null, data)

    expect(storage.getMemory('W1N1', null)).not.toBeNull()
    expect(storage.getMemory('W2N2', null)).toBeNull()
    expect(storage.getMemory('W3N3', null)).not.toBeNull()
  })
})

describe('Map2Storage — null adapter', () => {
  let storage: Map2Storage

  beforeEach(() => {
    storage = new Map2Storage({ adapter: null, namespace: 'offline', maxEntries: 10 })
  })

  it('get() returns null when adapter is null and memory is empty', async () => {
    expect(await storage.get('W7N7', 'shard0')).toBeNull()
  })

  it('put() + get() works via memory only when adapter is null', async () => {
    await storage.put('W7N7', 'shard0', DATA_A)
    expect(await storage.get('W7N7', 'shard0')).toEqual(DATA_A)
  })
})
