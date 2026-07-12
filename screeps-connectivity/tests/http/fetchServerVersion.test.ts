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
    const worldUrl = 'http://localhost:8080/(https://screeps.com)'
    const privUrl = 'http://localhost:8080/(http://my-private-server:21025)'
    // Exact URL → payload map (no substring host matching).
    const payloads: Record<string, string> = {
      [`${worldUrl}/api/authmod`]: 'official',
      [`${privUrl}/api/authmod`]: 'private',
    }
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: 1, backend: payloads[input] }), {
          headers: { 'content-type': 'application/json' },
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const world = await fetchAuthModInfo(worldUrl)
    const priv = await fetchAuthModInfo(privUrl)

    expect((world as { backend?: string })?.backend).toBe('official')
    expect((priv as { backend?: string })?.backend).toBe('private')
    // Both were real network fetches — neither served the other's cached entry.
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // A repeat of the first URL is served from cache (no third fetch).
    const worldAgain = await fetchAuthModInfo(worldUrl)
    expect((worldAgain as { backend?: string })?.backend).toBe('official')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
