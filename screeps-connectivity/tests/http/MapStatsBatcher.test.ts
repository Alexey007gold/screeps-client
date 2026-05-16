import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MapStatsBatcher } from '../../src/http/MapStatsBatcher.js'
import { HttpClient } from '../../src/http/HttpClient.js'
import { TokenAuth } from '../../src/http/auth/TokenAuth.js'

function mockResponse(body: unknown, opts: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...opts.headers },
    ...opts,
  })
}

describe('MapStatsBatcher', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let http: HttpClient
  let batcher: MapStatsBatcher

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    http = new HttpClient({ url: 'http://test.local', auth: new TokenAuth({ token: 't' }) })
    batcher = new MapStatsBatcher(http, 10)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves empty rooms immediately without network call', async () => {
    const res = await batcher.mapStats([], 'owner0')
    expect(res).toEqual({ ok: 1, stats: {}, users: {} })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('batches multiple calls into a single HTTP request', async () => {
    fetchMock.mockResolvedValue(mockResponse({
      ok: 1,
      stats: {
        W1N1: { own: { user: 'a', level: 1 } },
        W1N2: { own: { user: 'b', level: 2 } },
      },
      users: {},
    }))

    const p1 = batcher.mapStats(['W1N1'], 'owner0')
    const p2 = batcher.mapStats(['W1N2'], 'owner0')

    const [r1, r2] = await Promise.all([p1, p2])

    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.rooms).toContain('W1N1')
    expect(body.rooms).toContain('W1N2')

    expect(r1.stats).toHaveProperty('W1N1')
    expect(r1.stats).not.toHaveProperty('W1N2')
    expect(r2.stats).toHaveProperty('W1N2')
    expect(r2.stats).not.toHaveProperty('W1N1')
  })

  it('does not batch calls with different statName or shard', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ ok: 1, stats: {}, users: {} }))
      .mockResolvedValueOnce(mockResponse({ ok: 1, stats: {}, users: {} }))
      .mockResolvedValueOnce(mockResponse({ ok: 1, stats: {}, users: {} }))

    const p1 = batcher.mapStats(['W1N1'], 'owner0', 'shard0')
    const p2 = batcher.mapStats(['W1N1'], 'owner0', 'shard1')
    const p3 = batcher.mapStats(['W1N1'], 'status', 'shard0')

    await Promise.all([p1, p2, p3])

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('deduplicates rooms within a batch', async () => {
    fetchMock.mockResolvedValue(mockResponse({
      ok: 1,
      stats: { W1N1: { own: { user: 'a', level: 1 } } },
      users: {},
    }))

    const p1 = batcher.mapStats(['W1N1', 'W1N1'], 'owner0')
    const p2 = batcher.mapStats(['W1N1'], 'owner0')

    await Promise.all([p1, p2])

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.rooms).toEqual(['W1N1'])
  })

  it('forwards errors to all pending calls', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    const p1 = batcher.mapStats(['W1N1'], 'owner0')
    const p2 = batcher.mapStats(['W1N2'], 'owner0')

    await expect(p1).rejects.toThrow('network down')
    await expect(p2).rejects.toThrow('network down')
  })

  it('returns only the requested subset of stats to each caller', async () => {
    fetchMock.mockResolvedValue(mockResponse({
      ok: 1,
      stats: {
        W1N1: { own: { user: 'a', level: 1 } },
        W1N2: { own: { user: 'b', level: 2 } },
        W1N3: { own: { user: 'c', level: 3 } },
      },
      users: {
        a: { username: 'Alice' },
        b: { username: 'Bob' },
        c: { username: 'Charlie' },
      },
    }))

    const p1 = batcher.mapStats(['W1N1', 'W1N2'], 'owner0')
    const p2 = batcher.mapStats(['W1N2', 'W1N3'], 'owner0')

    const [r1, r2] = await Promise.all([p1, p2])

    expect(Object.keys(r1.stats)).toEqual(['W1N1', 'W1N2'])
    expect(Object.keys(r2.stats)).toEqual(['W1N2', 'W1N3'])
    // users object is shared unchanged
    expect(r1.users).toEqual(r2.users)
  })
})
