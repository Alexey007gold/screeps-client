import { describe, it, expect, afterEach, vi } from 'vitest'
import { isLocalServerUrl } from '../../src/utils/localServer'

describe('isLocalServerUrl', () => {
  it.each([
    'http://localhost:21025',
    'http://localhost',
    'http://dev.localhost:21025',
    'http://my-localhost-box:21025',
    'http://127.0.0.1:21025',
    'http://192.168.1.20:21025',
    'https://10.0.0.5/season',
    'http://[::1]:21025',
    'http://[fe80::1]:21025',
  ])('treats %s as local', (url) => {
    expect(isLocalServerUrl(url)).toBe(true)
  })

  it.each([
    'https://screeps.com',
    'https://screeps.com/season',
    'https://server.screepspl.us',
    'http://1.example.com:21025',
  ])('treats %s as remote', (url) => {
    expect(isLocalServerUrl(url)).toBe(false)
  })

  it('treats missing or malformed urls as remote', () => {
    expect(isLocalServerUrl(null)).toBe(false)
    expect(isLocalServerUrl('not a url')).toBe(false)
  })
})

describe('isLocalServerUrl behind screeps-client-proxy', () => {
  function stubProxy(backend?: string) {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:8080' },
      __SCREEPS_CLIENT_PROXY__: { kind: 'screeps-proxy', packageName: 'screeps-client-proxy', version: '1.0.0', backend },
    })
  }

  afterEach(() => vi.unstubAllGlobals())

  it('judges the wrapped backend, not the proxy origin', () => {
    stubProxy()
    expect(isLocalServerUrl('http://localhost:8080/(https://screeps.com)')).toBe(false)
    expect(isLocalServerUrl('http://localhost:8080/(http://192.168.1.20:21025)')).toBe(true)
  })

  it('judges the pinned backend when the proxy is pinned', () => {
    stubProxy('https://screeps.com')
    expect(isLocalServerUrl('http://localhost:8080')).toBe(false)
    stubProxy('http://127.0.0.1:21025')
    expect(isLocalServerUrl('http://localhost:8080')).toBe(true)
  })
})
