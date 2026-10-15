import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getTerrainCacheBlob, saveTerrainCacheBlob, terrainCacheKey, terrainCacheScope } from '../../src/renderer/terrainCache'
import { SS, setSession, removeSession } from '../../src/utils/storage'

function stubCacheStorage() {
  const cache = {
    match: vi.fn().mockResolvedValue(new Response(new Blob(['cached'], { type: 'image/webp' }))),
    put: vi.fn().mockResolvedValue(undefined),
  }
  const storage = {
    open: vi.fn().mockResolvedValue(cache),
    delete: vi.fn().mockResolvedValue(true),
  }
  vi.stubGlobal('caches', storage)
  vi.stubGlobal('Request', class { constructor(readonly url: string) {} })
  return { storage, cache }
}

describe('terrain bitmap cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    removeSession(SS.url)
  })

  it('reads and writes cached bitmaps for remote servers', async () => {
    const { cache } = stubCacheStorage()
    setSession(SS.url, 'https://screeps.com')
    const scope = terrainCacheScope('shard0')

    expect(await getTerrainCacheBlob(scope, 'W1N1', 0)).not.toBeNull()
    await saveTerrainCacheBlob(scope, 'W1N1', 0, new Blob(['x']))
    expect(cache.put).toHaveBeenCalledOnce()
  })

  it('bypasses cached bitmaps for local servers', async () => {
    const { storage } = stubCacheStorage()
    setSession(SS.url, 'http://localhost:21025')
    const scope = terrainCacheScope('shard0')

    expect(await getTerrainCacheBlob(scope, 'W1N1', 0)).toBeNull()
    await saveTerrainCacheBlob(scope, 'W1N1', 0, new Blob(['x']))
    expect(storage.open).not.toHaveBeenCalled()
  })
})

describe('terrainCacheScope', () => {
  beforeEach(() => removeSession(SS.url))

  it('separates servers that share a shard name', () => {
    setSession(SS.url, 'https://screeps.com')
    const official = terrainCacheScope('shard0')
    setSession(SS.url, 'http://localhost:21025')
    const local = terrainCacheScope('shard0')
    expect(official).not.toBe(local)
  })

  it('separates shards on the same server', () => {
    setSession(SS.url, 'https://screeps.com')
    expect(terrainCacheScope('shard0')).not.toBe(terrainCacheScope('shard1'))
  })
})

describe('terrainCacheKey', () => {
  it('keeps the scope in a single path segment', () => {
    const key = terrainCacheKey('https://screeps.com/season|shard0', 'W1N1', 1)
    expect(key.split('/')).toHaveLength(4)
    expect(key.endsWith('/W1N1_z1.webp')).toBe(true)
    expect(new URL(key, 'http://localhost').pathname).toBe(key)
  })
})
