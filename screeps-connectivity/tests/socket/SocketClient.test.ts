import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SocketClient } from '../../src/socket/SocketClient.js'

class MockWS {
  static instances: MockWS[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  sent: string[] = []

  constructor(public url: string) {
    MockWS.instances.push(this)
  }

  send(data: string) { this.sent.push(data) }
  close() { this.onclose?.() }

  simulateOpen() { this.onopen?.() }
  simulateMessage(data: string) { this.onmessage?.({ data } as MessageEvent) }
  simulateClose() { this.onclose?.() }
}

beforeEach(() => { MockWS.instances = [] })

function makeClient() {
  return new SocketClient({ url: 'http://test.local', WebSocket: MockWS as unknown as typeof WebSocket })
}

async function connectClient(client: SocketClient, token = 'tok') {
  const connectPromise = client.connect(token)
  const ws = MockWS.instances[0]
  ws.simulateOpen()
  ws.simulateMessage('auth ok newtoken')
  await connectPromise
  return ws
}

describe('SocketClient', () => {
  it('connects to the correct WebSocket URL', async () => {
    const client = makeClient()
    const promise = client.connect('tok')
    const ws = MockWS.instances[0]
    expect(ws.url).toBe('ws://test.local/socket/websocket')
    ws.simulateOpen()
    ws.simulateMessage('auth ok tok')
    await promise
  })

  it('sends auth token on open', async () => {
    const client = makeClient()
    const ws = await connectClient(client)
    expect(ws.sent).toContain('auth tok')
  })

  it('resolves connect() after auth ok', async () => {
    const client = makeClient()
    await expect(connectClient(client)).resolves.toBeDefined()
  })

  it('does not send gzip on by default', async () => {
    const client = makeClient()
    const ws = await connectClient(client)
    expect(ws.sent).not.toContain('gzip on')
  })

  it('sends gzip on when explicitly enabled, before any subscribe', async () => {
    const client = new SocketClient({ url: 'https://screeps.com', gzip: true, WebSocket: MockWS as unknown as typeof WebSocket })
    const connectPromise = client.connect('tok')
    const ws = MockWS.instances[0]
    ws.simulateOpen()
    ws.simulateMessage('auth ok newtoken')
    await connectPromise
    expect(ws.sent).toContain('gzip on')
    // gzip on must precede subscribes so the first updates already arrive as gz:
    client.subscribe('room:shard0/W7N7')
    expect(ws.sent.indexOf('gzip on')).toBeLessThan(ws.sent.indexOf('subscribe room:shard0/W7N7'))
  })

  it('explicit gzip:false does not send gzip on', async () => {
    const client = new SocketClient({ url: 'https://screeps.com', gzip: false, WebSocket: MockWS as unknown as typeof WebSocket })
    const ws = await connectClient(client)
    expect(ws.sent).not.toContain('gzip on')
  })

  it('subscribe sends subscribe message when authed', async () => {
    const client = makeClient()
    const ws = await connectClient(client)
    ws.sent.length = 0
    client.subscribe('room:shard0/W7N7')
    expect(ws.sent).toContain('subscribe room:shard0/W7N7')
  })

  it('subscribe refcounts — subscribe message sent only once for multiple subs', async () => {
    const client = makeClient()
    const ws = await connectClient(client)
    ws.sent.length = 0
    client.subscribe('room:shard0/W7N7')
    client.subscribe('room:shard0/W7N7')
    const subscribeMsgs = ws.sent.filter(s => s.startsWith('subscribe'))
    expect(subscribeMsgs).toHaveLength(1)
  })

  it('unsubscribe sent when last subscriber disposes', async () => {
    const client = makeClient()
    const ws = await connectClient(client)
    const sub1 = client.subscribe('room:shard0/W7N7')
    const sub2 = client.subscribe('room:shard0/W7N7')
    ws.sent.length = 0
    sub1.dispose()
    expect(ws.sent.filter(s => s.startsWith('unsubscribe'))).toHaveLength(0)
    sub2.dispose()
    expect(ws.sent).toContain('unsubscribe room:shard0/W7N7')
  })

  it('on() delivers channel messages to listener', async () => {
    const client = makeClient()
    const ws = await connectClient(client)
    const handler = vi.fn()
    client.on('user:uid/cpu', handler)
    ws.simulateMessage(JSON.stringify(['user:uid/cpu', { cpu: 25 }]))
    await new Promise(r => setTimeout(r, 0))
    expect(handler).toHaveBeenCalledWith({ cpu: 25 })
  })

  it('on() subscription dispose removes listener', async () => {
    const client = makeClient()
    const ws = await connectClient(client)
    const handler = vi.fn()
    const sub = client.on('user:uid/cpu', handler)
    sub.dispose()
    ws.simulateMessage(JSON.stringify(['user:uid/cpu', { cpu: 25 }]))
    await new Promise(r => setTimeout(r, 0))
    expect(handler).not.toHaveBeenCalled()
  })

  it('isConnected reflects state', async () => {
    const client = makeClient()
    expect(client.isConnected).toBe(false)
    await connectClient(client)
    expect(client.isConnected).toBe(true)
    client.disconnect()
    expect(client.isConnected).toBe(false)
    // After intentional disconnect, no reconnect should be attempted
    await new Promise(r => setTimeout(r, 0))
    expect(MockWS.instances).toHaveLength(1)
  })

  it('disconnect() prevents reconnect even when not currently reconnecting', async () => {
    const client = makeClient()
    const _ws = await connectClient(client)
    client.disconnect()
    // After disconnect, scheduleReconnect should be a no-op
    // We verify by checking no new WS instance is created after a tick
    await new Promise(r => setTimeout(r, 0))
    expect(MockWS.instances).toHaveLength(1)  // only the original one
  })

  it('disconnected event has willReconnect: false when disconnect() is called', async () => {
    const client = makeClient()
    const _ws = await connectClient(client)
    let willReconnect: boolean | undefined
    client.on('disconnected', (data) => {
      willReconnect = (data as { willReconnect: boolean }).willReconnect
    })
    client.disconnect()
    expect(willReconnect).toBe(false)
  })

  it('disconnected event is flagged intentional when disconnect() is called', async () => {
    const client = makeClient()
    const _ws = await connectClient(client)
    let intentional: boolean | undefined
    client.on('disconnected', (data) => {
      intentional = (data as { intentional: boolean }).intentional
    })
    client.disconnect()
    expect(intentional).toBe(true)
  })

  it('disconnected event has willReconnect: true for a non-intentional close, since a reconnect attempt is about to start', async () => {
    const client = makeClient()
    const ws = await connectClient(client)
    let willReconnect: boolean | undefined
    client.on('disconnected', (data) => {
      willReconnect = (data as { willReconnect: boolean }).willReconnect
    })
    ws.simulateClose()
    expect(willReconnect).toBe(true)
    client.disconnect()
  })

  describe('reconnect', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('emits socket:error and closes the socket when the restarted server rejects the token', async () => {
      const client = makeClient()
      const ws = await connectClient(client)
      const errors: unknown[] = []
      client.on('socket:error', (err) => errors.push(err))

      ws.simulateClose()
      await vi.advanceTimersByTimeAsync(100)
      const retryWs = MockWS.instances[1]
      retryWs.simulateOpen()
      retryWs.simulateMessage('auth failed')
      await vi.advanceTimersByTimeAsync(0)

      expect(errors).toHaveLength(1)
      expect(client.isConnected).toBe(false)
    })

    it('keeps retrying when a reconnect attempt closes before auth completes', async () => {
      const client = makeClient()
      const ws = await connectClient(client)

      ws.simulateClose()
      await vi.advanceTimersByTimeAsync(100)
      const firstRetry = MockWS.instances[1]
      firstRetry.simulateOpen()
      firstRetry.simulateClose()
      await vi.advanceTimersByTimeAsync(200)

      const secondRetry = MockWS.instances[2]
      secondRetry.simulateOpen()
      secondRetry.simulateMessage('auth ok tok2')
      await vi.advanceTimersByTimeAsync(0)

      expect(client.isConnected).toBe(true)
      expect(MockWS.instances).toHaveLength(3)
      client.disconnect()
    })

    it('reconnects again after a later drop once a reconnect has succeeded', async () => {
      const client = makeClient()
      const ws = await connectClient(client)
      client.subscribe('room:shard0/W1N1')

      ws.simulateClose()
      await vi.advanceTimersByTimeAsync(100)
      const firstRetry = MockWS.instances[1]
      firstRetry.simulateOpen()
      firstRetry.simulateMessage('auth ok tok2')
      await vi.advanceTimersByTimeAsync(0)
      expect(firstRetry.sent).toContain('subscribe room:shard0/W1N1')

      firstRetry.simulateClose()
      await vi.advanceTimersByTimeAsync(100)
      const secondRetry = MockWS.instances[2]
      secondRetry.simulateOpen()
      secondRetry.simulateMessage('auth ok tok3')
      await vi.advanceTimersByTimeAsync(0)

      expect(client.isConnected).toBe(true)
      expect(secondRetry.sent).toContain('subscribe room:shard0/W1N1')
      client.disconnect()
    })
  })
})
