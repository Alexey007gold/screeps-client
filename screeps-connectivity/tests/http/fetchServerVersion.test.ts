import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchAuthModInfo } from '../../src/http/fetchServerVersion.js'

// Minimal in-memory sessionStorage stub (the node test env has none).
class MemorySessionStorage {
  private readonly map = new Map<string, string>()
  getItem(k: string): string | null { return this.map.get(k) ?? null }
  setItem(k: string, v: string): void { this.map.set(k, v) }
  removeItem(k: string): void { this.map.delete(k) }
  clear(): void { this.map.clear() }
}

describe('fetchAuthModInfo — session cache namespacing', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', new MemorySessionStorage())
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('does not collide between two backends wrapped under the same proxy host', async () => {
    // Both URLs share host `localhost:8080`; only the /(backend) path differs —
    // exactly how screeps-client-proxy addresses distinct servers. The cache key
    // must include the path, otherwise the second lookup returns the first's data.
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      const backend = input.includes('screeps.com') ? 'official' : 'private'
      return Promise.resolve(
        new Response(JSON.stringify({ ok: 1, backend }), {
          headers: { 'content-type': 'application/json' },
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const world = await fetchAuthModInfo('http://localhost:8080/(https://screeps.com)')
    const priv = await fetchAuthModInfo('http://localhost:8080/(http://my-private-server:21025)')

    expect((world as { backend?: string })?.backend).toBe('official')
    expect((priv as { backend?: string })?.backend).toBe('private')
    // Both were real network fetches — neither served the other's cached entry.
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // A repeat of the first URL is served from cache (no third fetch).
    const worldAgain = await fetchAuthModInfo('http://localhost:8080/(https://screeps.com)')
    expect((worldAgain as { backend?: string })?.backend).toBe('official')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
