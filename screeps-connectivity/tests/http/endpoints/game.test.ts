import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HttpClient } from '../../../src/http/HttpClient.js'
import { TokenAuth } from '../../../src/http/auth/TokenAuth.js'

function mockResponse(body: unknown, opts: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...opts.headers },
    ...opts,
  })
}

describe('game endpoints', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('createFlag sends POST to /api/game/create-flag', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: 1 }))
    const http = new HttpClient({ url: 'http://test.local', auth: new TokenAuth({ token: 't' }) })

    await http.game.createFlag('E2N2', 15, 25, 'MyFlag', 1, 2, 'shard1')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/game/create-flag')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      room: 'E2N2',
      x: 15,
      y: 25,
      name: 'MyFlag',
      color: 1,
      secondaryColor: 2,
      shard: 'shard1',
    })
  })

  it('createFlag omits shard when not provided', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: 1 }))
    const http = new HttpClient({ url: 'http://test.local', auth: new TokenAuth({ token: 't' }) })

    await http.game.createFlag('E2N2', 15, 25, 'MyFlag', 1, 2)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      room: 'E2N2',
      x: 15,
      y: 25,
      name: 'MyFlag',
      color: 1,
      secondaryColor: 2,
    })
  })

  it('genUniqueFlagName sends POST to /api/game/gen-unique-flag-name', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: 1, name: 'Flag1' }))
    const http = new HttpClient({ url: 'http://test.local', auth: new TokenAuth({ token: 't' }) })

    const res = await http.game.genUniqueFlagName()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/game/gen-unique-flag-name')
    expect(init.method).toBe('POST')
    expect(res.name).toBe('Flag1')
  })

  it('checkUniqueFlagName sends POST to /api/game/check-unique-flag-name', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: 1 }))
    const http = new HttpClient({ url: 'http://test.local', auth: new TokenAuth({ token: 't' }) })

    await http.game.checkUniqueFlagName('MyFlag')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/game/check-unique-flag-name')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'MyFlag' })
  })
})
