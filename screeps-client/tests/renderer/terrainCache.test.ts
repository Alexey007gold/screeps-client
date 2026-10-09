import { describe, it, expect, beforeEach } from 'vitest'
import { terrainCacheKey, terrainCacheScope } from '../../src/renderer/terrainCache'
import { SS, setSession, removeSession } from '../../src/utils/storage'

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
