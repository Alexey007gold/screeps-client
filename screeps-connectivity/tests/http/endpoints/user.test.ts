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

describe('user endpoints', () => {
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

  it('find sends GET with username query param', async () => {
    await http.user.find({ username: 'Tigga' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/user/find')
    expect(url).toContain('username=Tigga')
  })

  it('find sends GET with id query param', async () => {
    await http.user.find({ id: 'abc123' })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('id=abc123')
  })

  it('moneyHistory sends GET without page when omitted', async () => {
    await http.user.moneyHistory()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/user/money-history')
    expect(url).not.toContain('page')
  })

  it('moneyHistory sends GET with page param', async () => {
    await http.user.moneyHistory(2)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('page=2')
  })

  it('respawn sends POST to /api/user/respawn', async () => {
    await http.user.respawn()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/user/respawn')
  })

  it('respawnProhibitedRooms sends GET', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: 1, rooms: [] }))
    await http.user.respawnProhibitedRooms()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/user/respawn-prohibited-rooms')
  })

  it('badge sends POST with badge body', async () => {
    const badge = { type: 1, color1: '#ff0000', color2: '#00ff00', color3: '#0000ff', flip: false }
    await http.user.badge(badge)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/user/badge')
    expect(JSON.parse(init.body as string)).toEqual({ badge })
  })

  it('setActiveBranch sends POST with activeName and branch', async () => {
    await http.user.setActiveBranch('activeWorld', 'main')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/user/set-active-branch')
    expect(JSON.parse(init.body as string)).toEqual({ activeName: 'activeWorld', branch: 'main' })
  })

  it('cloneBranch sends POST with newName', async () => {
    await http.user.cloneBranch('backup')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/user/clone-branch')
    expect(JSON.parse(init.body as string)).toEqual({ newName: 'backup' })
  })

  it('cloneBranch includes branch and defaultModules when provided', async () => {
    await http.user.cloneBranch('backup', 'main', true)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toEqual({ newName: 'backup', branch: 'main', defaultModules: true })
  })

  it('deleteBranch sends POST with branch', async () => {
    await http.user.deleteBranch('old-branch')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/user/delete-branch')
    expect(JSON.parse(init.body as string)).toEqual({ branch: 'old-branch' })
  })

  it('notifyPrefs sends POST with partial prefs', async () => {
    await http.user.notifyPrefs({ disabled: true, interval: 60 })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/user/notify-prefs')
    expect(JSON.parse(init.body as string)).toEqual({ disabled: true, interval: 60 })
  })

  it('tutorialDone sends POST', async () => {
    await http.user.tutorialDone()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/user/tutorial-done')
  })

  it('email sends POST with email', async () => {
    await http.user.email('test@example.com')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/user/email')
    expect(JSON.parse(init.body as string)).toEqual({ email: 'test@example.com' })
  })

  it('setSteamVisible sends POST with visible flag', async () => {
    await http.user.setSteamVisible(false)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/user/set-steam-visible')
    expect(JSON.parse(init.body as string)).toEqual({ visible: false })
  })
})
