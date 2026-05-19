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

describe('user.messages endpoints', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let http: HttpClient

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(mockResponse({ ok: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    http = new HttpClient({ url: 'http://test.local', auth: new TokenAuth({ token: 't' }) })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('send sends POST with respondent and text', async () => {
    await http.user.messages.send('Tigga', 'hello')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/user/messages/send')
    expect(JSON.parse(init.body as string)).toEqual({ respondent: 'Tigga', text: 'hello' })
  })

  it('list sends GET with respondent query param', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: 1, messages: [] }))
    await http.user.messages.list('Tigga')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/user/messages/list')
    expect(url).toContain('respondent=Tigga')
  })

  it('index sends GET to /api/user/messages/index', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: 1, list: [] }))
    await http.user.messages.index()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/user/messages/index')
  })

  it('markRead sends POST with id', async () => {
    await http.user.messages.markRead('msg-id-123')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/user/messages/mark-read')
    expect(JSON.parse(init.body as string)).toEqual({ id: 'msg-id-123' })
  })

  it('unreadCount sends GET to /api/user/messages/unread-count', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: 1, count: 3 }))
    const res = await http.user.messages.unreadCount()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/user/messages/unread-count')
    expect(res.count).toBe(3)
  })
})
