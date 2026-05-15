# screeps-connectivity

TypeScript library for connecting to Screeps servers. Handles HTTP, WebSocket, authentication, data stores, caching, and persistent storage — with zero production dependencies.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [ScreepsClient](#screepsclient)
- [Authentication](#authentication)
- [Stores](#stores)
  - [UserStore](#userstore)
  - [ServerStore](#serverstore)
  - [RoomStore](#roomstore)
- [Subscriptions](#subscriptions)
- [HTTP Endpoints](#http-endpoints)
- [Storage](#storage)
- [Logging](#logging)
- [Types Reference](#types-reference)
  - [WorldInfo](#worldinfo)

---

## Installation

```sh
npm install screeps-connectivity
```

`FileStorage` (Node.js only) is a separate entry point to keep browser bundles clean:

```ts
import { FileStorage } from 'screeps-connectivity/file-storage'
```

---

## Quick Start

```ts
import { ScreepsClient, TokenAuth, IndexedDBStorage } from 'screeps-connectivity'

const client = new ScreepsClient({
  url: 'https://screeps.com',
  auth: new TokenAuth({ token: 'your-token' }),
  storage: new IndexedDBStorage('my-app'),
})

// Subscribe to user info before connecting — fires once the eager fetch completes
client.stores.user.on('user:me', (info) => {
  console.log('Connected as', info.username, `(CPU limit: ${info.cpu})`)
})

// Subscribe to live CPU stats
const sub = client.stores.user.subscribe('cpu')
client.stores.user.on('user:cpu', ({ cpu, memory }) => {
  console.log(`CPU: ${cpu}  Memory: ${memory}`)
})

await client.connect()

// Later: load a room
const terrain = await client.stores.room.terrain('W7N7', 'shard0')
const roomSub = client.stores.room.subscribe('W7N7', 'shard0')
client.stores.room.on('room:update', ({ gameTime, objects, diff }) => {
  console.log('Tick', gameTime, 'objects:', Object.keys(objects).length, 'changed:', Object.keys(diff).length)
})

// Cleanup
sub.dispose()
roomSub.dispose()
client.disconnect()
```

---

## Architecture

```
ScreepsClient          — facade, wires everything together
  ├─ HttpClient        — fetch wrapper, auth headers, rate-limit tracking, gzip decompression
  │    └─ endpoints/   — auth · game · user · leaderboard · experimental
  └─ SocketClient      — WebSocket lifecycle, exponential-backoff reconnect, sub ref-counting
       └─ MessageParser — plain-text commands and JSON-array messages, gzip via DecompressionStream
DataStores             — RoomStore · UserStore · ServerStore (extend TypedStore → EventTarget)
Cache                  — two-tier: in-memory Map + optional StorageAdapter, namespaced by server
StorageAdapter         — binary interface (Uint8Array): IndexedDBStorage · FileStorage · NullStorage
```

`ScreepsClient` is the only entry point consumers instantiate. After `connect()` authenticates and opens the WebSocket, two background fetches kick off automatically: `user/me` (needed to resolve WebSocket subscription channels) and `api/version` (needed to determine server type). Both emit typed events when they complete.

---

## ScreepsClient

```ts
import { ScreepsClient } from 'screeps-connectivity'

const client = new ScreepsClient(opts: ScreepsClientOptions)
```

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `url` | `string` | ✓ | Base URL of the Screeps server |
| `auth` | `AuthStrategy` | ✓ | Authentication strategy |
| `storage` | `StorageAdapter \| null` | — | Persistent storage for terrain/cache. `null` disables persistence. |
| `WebSocket` | `typeof WebSocket` | — | Custom WebSocket constructor for Node 18/20 compatibility |
| `debug` | `boolean \| LogFn` | — | Enable debug logging (see [Logging](#logging)) |

### Methods

```ts
client.connect(): Promise<void>
```
Authenticates via the injected `AuthStrategy`, opens the WebSocket, then triggers background fetches for `user/me` and `server/version`.

```ts
client.disconnect(): void
```
Closes the WebSocket immediately. Does not reconnect.

```ts
client.clearCache(): Promise<void>
```
Clears all cached data for this server — both the in-memory cache (user info, server version, terrain, etc.) and the persistent storage (IndexedDB / file). Subsequent reads will re-fetch from the network. Useful after a server wipe, during development, or to free storage space.

> The cache is namespaced by server hostname, so calling this on one `ScreepsClient` instance does not affect data cached for other servers.

### Properties

| Property | Type | Description |
|---|---|---|
| `isConnected` | `boolean` | Whether the WebSocket is currently authenticated |
| `http` | `HttpClient` | Direct HTTP client for one-off requests |
| `socket` | `SocketClient` | Direct WebSocket client |
| `stores.user` | `UserStore` | User data and live subscriptions |
| `stores.server` | `ServerStore` | Server metadata |
| `stores.room` | `RoomStore` | Room terrain and live object updates |

---

## Authentication

Two built-in strategies are provided. Both implement the `AuthStrategy` interface.

### TokenAuth

For pre-issued tokens (official server, private server with token auth):

```ts
import { TokenAuth } from 'screeps-connectivity'

new TokenAuth({ token: 'your-auth-token' })
```

### PasswordAuth

Exchanges email + password for a token on connect:

```ts
import { PasswordAuth } from 'screeps-connectivity'

new PasswordAuth({ email: 'user@example.com', password: 'secret' })
```

### GuestAuth

Read-only observer access for `xxscreeps`-compatible private servers. No account or credentials required. The server accepts the literal token `"guest"` and grants a read-only view of the world.

> **Note**: Not supported on the official `screeps.com` server. Guest sessions cannot write code, execute console commands, or access user-specific endpoints — `UserStore.me()` will fail silently.

```ts
import { GuestAuth } from 'screeps-connectivity'

const client = new ScreepsClient({
  url: 'http://localhost:21025',
  auth: new GuestAuth(),
})

await client.connect()
// Can now observe rooms, terrain, and live object updates
// without being signed in
```

### Custom AuthStrategy

Implement `AuthStrategy` to handle any custom auth flow:

```ts
import type { AuthStrategy, HttpClient } from 'screeps-connectivity'

class MyAuth implements AuthStrategy {
  async authenticate(http: HttpClient): Promise<string> {
    // Call any endpoint, return the bearer token string
    const res = await http.auth.signin(this.email, this.password)
    return res.token
  }
}
```

---

## Stores

All stores extend `TypedStore<EventMap>`, which extends `EventTarget`. Use `store.on(type, handler)` to subscribe to typed events — it returns a `Subscription` with a `dispose()` method.

```ts
const sub = store.on('event:type', (detail) => { /* ... */ })
sub.dispose() // unsubscribe
```

### UserStore

`client.stores.user`

Manages the current user's identity, CPU stats, console output, and code change notifications.

**Eager fetch on connect**: `me()` is called automatically after `connect()` resolves so the user ID is available before any `subscribe()` call.

#### Properties

| Property | Type | Description |
|---|---|---|
| `userInfo` | `UserInfo \| null` | Synchronous getter; populated after the first `me()` fetch |
| `cpu` | `CpuStats \| null` | Last received CPU stats (updated via subscription) |
| `console` | `ConsoleMessage[]` | Rolling buffer of received console messages (max `maxConsoleSize`, default 100) |

#### Methods

```ts
userStore.me(): Promise<UserInfo>
```
Fetches the authenticated user's profile. Cached for 60 seconds. Emits `user:me` on every network fetch (not on cache hits).

```ts
userStore.refreshMe(): Promise<UserInfo>
```
Busts the cache and re-fetches. Use after profile changes (username, badge, etc.).

```ts
userStore.subscribe(channel: 'cpu' | 'console' | 'code'): Subscription
```
Opens a WebSocket subscription for the given user channel. Lazily resolves the user ID if `me()` has not yet been called.

| Channel | Event emitted | Payload |
|---|---|---|
| `cpu` | `user:cpu` | `CpuStats` |
| `console` | `user:console` | `{ messages: ConsoleMessage }` |
| `code` | `user:code` | `{ branch: string; modules: Record<string, string> }` |

#### Events

| Event | Payload | When |
|---|---|---|
| `user:me` | `UserInfo` | After `me()` or `refreshMe()` fetches from the network |
| `user:cpu` | `CpuStats` | Each WebSocket CPU tick |
| `user:console` | `{ messages: ConsoleMessage }` | Each console message batch |
| `user:code` | `{ branch: string; modules: Record<string, string> }` | When code is deployed |

**Example**:
```ts
// Show a live CPU bar
const group = new SubscriptionGroup()
group.add(client.stores.user.subscribe('cpu'))
group.add(client.stores.user.on('user:cpu', ({ cpu, memory }) => {
  updateUI(cpu, memory)
}))
// later:
group.dispose()
```

---

### ServerStore

`client.stores.server`

Manages server metadata: version info, shard list, and connection lifecycle events.

**Eager fetch on connect**: `version()` is called automatically after `connect()` so `isPrivateServer` is available without an explicit fetch.

#### Properties

| Property | Type | Description |
|---|---|---|
| `versionInfo` | `ServerVersion \| null` | Synchronous getter; populated after the first `version()` fetch |
| `isPrivateServer` | `boolean \| null` | `true` if the server has no shards (private), `false` for official multi-shard, `null` if not yet determined |
| `shardList` | `ShardInfo[] \| null` | Synchronous getter; populated after `shards()` is called |

#### Methods

```ts
serverStore.version(): Promise<ServerVersion>
```
Fetches server version and feature flags. Cached for 5 minutes. Emits `server:version` on network fetch.

```ts
serverStore.refreshVersion(): Promise<ServerVersion>
```
Busts the cache and re-fetches.

```ts
serverStore.shards(): Promise<ShardInfo[]>
```
Fetches the list of active shards. Cached for 5 minutes. Emits `server:shards` on network fetch. Not available on private servers — only call after confirming `isPrivateServer === false`.

```ts
serverStore.refreshShards(): Promise<ShardInfo[]>
```
Busts the cache and re-fetches.

```ts
serverStore.worldInfo(shard?: string): Promise<WorldInfo>
```
Fetches and caches world size and coordinate bounds for a shard. Cached for 10 minutes per shard.

Internally makes two requests:
1. `GET /api/game/world-size` — retrieves `width` and `height`.
2. `POST /api/game/map-stats` for the four quadrant-origin rooms (`W0N0`, `E0N0`, `W0S0`, `E0S0`) — determines which quadrants actually contain rooms, from which `minX`/`maxX`/`minY`/`maxY` are computed.

The resulting `WorldInfo` can be used to validate room coordinates before making requests or triggering navigation. If `shard` is omitted the request is sent without a shard parameter (correct for single-shard private servers).

```ts
const info = await client.stores.server.worldInfo()
// Private server example: { width: 11, height: 11, minX: -11, maxX: -1, minY: -11, maxY: -1 }

function roomExists(x: number, y: number): boolean {
  return x >= info.minX && x <= info.maxX && y >= info.minY && y <= info.maxY
}
```

```ts
serverStore.invalidateWorldInfo(shard?: string): void
```
Removes the cached `WorldInfo` for the given shard so the next `worldInfo()` call re-fetches. Use after a server map reset.

#### Events

| Event | Payload | When |
|---|---|---|
| `server:connected` | `{}` | WebSocket authenticated and ready |
| `server:disconnected` | `{ willReconnect: boolean }` | WebSocket closed |
| `server:error` | `{ error: Error }` | Reconnect exhausted or auth failure |
| `server:version` | `ServerVersion` | After `version()` or `refreshVersion()` network fetch |
| `server:shards` | `ShardInfo[]` | After `shards()` or `refreshShards()` network fetch |

**Example — private server detection**:
```ts
client.stores.server.on('server:version', () => {
  if (client.stores.server.isPrivateServer) {
    hideShardSelector()
  }
})

await client.connect() // version() fires in background, event arrives shortly after
```

---

### RoomStore

`client.stores.room`

Manages room terrain (persistent cache) and live room object updates via WebSocket.

#### Methods

```ts
roomStore.terrain(room: string, shard: string | null): Promise<RoomTerrain>
```
Fetches and caches terrain for a room. Check order: memory cache → persistent storage → HTTP. Emits `room:terrainavailable` on first network fetch. Pass `null` for shard on private servers.

```ts
roomStore.terrainBulk(rooms: string[], shard: string | null): Promise<Map<string, RoomTerrain>>
```
Fetches terrain for multiple rooms efficiently, using the same three-tier cache as `terrain()`. Only rooms missing from both memory and persistent storage are fetched from the server — in a single bulk HTTP request. Emits `room:terrainavailable` for each room fetched from HTTP.

Returns a `Map<roomName, RoomTerrain>`. Rooms that could not be resolved (not returned by the server) will be absent from the map.

```ts
// Load terrain for an 11×11 overview area around a room
const roomNames = getNeighbourRooms('E5N5', radius: 5)
const terrains = await client.stores.room.terrainBulk(roomNames, 'shard0')

for (const [room, terrain] of terrains) {
  renderMinimap(room, terrain)
}
```

```ts
roomStore.objects(room: string, shard: string | null): RoomObjectMap | null
```
Synchronous getter for the current in-memory object map. Returns `null` if the room has not been subscribed or fetched yet.

```ts
roomStore.fetchObjects(room: string, shard: string | null): Promise<void>
```
Fetches the current room object snapshot via HTTP and stores it in memory. Does not start a live subscription.

```ts
roomStore.subscribeMap2(room: string, shard: string | null): Subscription
```
Opens a WebSocket subscription for the low-detail `roomMap2` channel. Delivers one `room:map2update` event per tick with object positions grouped by type and user. Uses the same ref-counting as `subscribe()`. Pass `null` for shard on private servers.

```ts
roomStore.map2data(room: string, shard: string | null): RoomMap2Data | null
```
Synchronous getter for the last received `roomMap2` snapshot. Returns `null` if `subscribeMap2` has not been called or no data has arrived yet.

```ts
roomStore.subscribe(room: string, shard: string | null): Subscription
```
Opens a WebSocket subscription for live room updates. Manages ref-counting internally — the socket subscription is only sent once per unique room/shard and only removed when the last subscriber disposes.

The first WebSocket message for a room is the full object state; subsequent messages are diffs. `RoomStore` merges diffs internally so `room:update` always delivers complete state in `objects`. The raw per-tick diff is also available as `diff` for event processing.

#### Events

| Event | Payload | When |
|---|---|---|
| `room:update` | `{ room, shard, gameTime, objects: RoomObjectMap, diff: RoomObjectDiff }` | Each WebSocket tick for a subscribed room |
| `room:terrainavailable` | `{ room, shard, terrain: RoomTerrain }` | After terrain is fetched from HTTP (not from cache) |
| `room:map2update` | `{ room, shard, data: RoomMap2Data }` | Each tick for a subscribed `roomMap2` channel |

**`objects` vs `diff`**: `objects` is the fully merged state — every object in the room with all its current fields, suitable for rendering. `diff` contains only what the server sent this tick: partial objects with only changed fields, and `null` for deleted objects. Use `objects` to draw the room; use `diff` to detect per-tick events (actions, deaths, spawns) without comparing previous and current state.

Creep actions are carried in each creep's `actionLog` field within the diff. An `actionLog` entry is non-null when that action was performed this tick — for example `actionLog.upgradeController: { x, y }` when the creep upgraded a controller:

```ts
group.add(client.stores.room.on('room:update', ({ objects, diff, gameTime }) => {
  // rendering — always complete state
  renderObjects(objects, gameTime)

  // per-tick events — only what changed
  for (const [id, d] of Object.entries(diff)) {
    if (d === null) onObjectDeleted(id)
    else if (d.actionLog?.upgradeController) onUpgrade(objects[id])
    else if (d.actionLog?.attack) onAttack(objects[id])
  }
}))
```

**Terrain data format**: `RoomTerrain` wraps a `Uint8Array(2500)` — one byte per tile, values 0–3 (`TerrainType.Plain`, `TerrainType.Wall`, `TerrainType.Swamp`). Stored as raw binary in persistent storage.

```ts
const terrain = await client.stores.room.terrain('W7N7', 'shard0')
const type = terrain.get(24, 24) // TerrainType at (x=24, y=24)
```

**Example — live room view**:
```ts
const group = new SubscriptionGroup()

const terrain = await client.stores.room.terrain('W7N7', 'shard0')
renderTerrain(terrain)

group.add(client.stores.room.subscribe('W7N7', 'shard0'))
group.add(client.stores.room.on('room:update', ({ gameTime, objects, diff }) => {
  renderObjects(objects, gameTime)
  // diff available here for action/event processing
}))

// Cleanup when navigating away
group.dispose()
```

---

## Subscriptions

### Subscription

Every `store.on()` and `store.subscribe()` call returns a `Subscription`:

```ts
interface Subscription {
  dispose(): void
}
```

Call `dispose()` to unregister the listener and release any WebSocket channel ref-counts.

### SubscriptionGroup

Composes multiple subscriptions for batch teardown — maps directly to framework cleanup hooks:

```ts
import { SubscriptionGroup } from 'screeps-connectivity'

const group = new SubscriptionGroup()
group.add(client.stores.user.subscribe('cpu'))
group.add(client.stores.user.on('user:cpu', handler))
group.add(client.stores.room.subscribe('W1N1', 'shard0'))

// SolidJS
onCleanup(() => group.dispose())

// Svelte
onDestroy(() => group.dispose())
```

---

## HTTP Endpoints

`client.http` exposes all endpoints grouped by domain. You rarely need to call these directly — the stores wrap the common ones with caching and event emission.

### `client.http.auth`

```ts
http.auth.me(): Promise<ApiAuthMeResponse>
http.auth.signin(email, password): Promise<ApiAuthSigninResponse>
http.auth.queryToken(token): Promise<ApiAuthQueryTokenResponse>
```

### `client.http.game`

```ts
http.game.roomTerrain(room, shard?): Promise<ApiRoomTerrainResponse>
http.game.roomObjects(room, shard?): Promise<ApiRoomObjectsResponse>
http.game.roomStatus(room, shard?): Promise<{ ok, status, novice? }>
http.game.roomOverview(room, interval?, shard?): Promise<unknown>
http.game.time(shard?): Promise<{ ok, time }>
http.game.worldSize(shard?): Promise<unknown>
http.game.mapStats(rooms, statName, shard?): Promise<ApiMapStatsResponse>
http.game.roomsTerrain(rooms, shard?): Promise<ApiGameRoomsResponse>
http.game.market.ordersIndex(shard?): Promise<unknown>
http.game.market.myOrders(): Promise<unknown>
http.game.market.orders(resourceType, shard?): Promise<unknown>
http.game.market.stats(resourceType, shard?): Promise<unknown>
http.game.shards.info(): Promise<ApiShardsInfoResponse>
```

Default shard is `'shard0'` for all endpoints that accept one.

#### `mapStats` detail

Fetches bulk room metadata for a list of rooms in a single POST request. Useful for map overlays that need ownership, room status, or mineral data across many rooms at once.

```ts
const result = await client.http.game.mapStats(
  ['W1N1', 'W1N2', 'E5N3'],
  'owner0',   // statName
  'shard0',   // optional, default 'shard0'
)
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `rooms` | `string[]` | Room names to query. Can be arbitrarily large. |
| `statName` | `string` | Stat category. Common values: `'owner0'` (ownership + minerals), `'claim0'` (claim info) |
| `shard` | `string` | Shard name. Defaults to `'shard0'`. |

**Response shape** (`ApiMapStatsResponse`)

```ts
interface ApiMapStatsResponse {
  ok: number
  gameTime: number
  stats: Record<string, ApiMapStatsRoomStat>   // keyed by room name
  statsMax: Record<string, unknown>
  users: Record<string, {                       // keyed by user _id
    _id: string
    username: string
    badge: ApiMapStatsBadge
  }>
}

interface ApiMapStatsRoomStat {
  status: string           // 'normal' | 'out of borders' | 'novice' | 'respawn'
  novice: number | null    // timestamp when novice protection expires, or null
  respawnArea: number | null
  openTime: number | null
  own?: { user: string; level: number }         // present when room is owned
  minerals0?: { type: string; density: number } // primary mineral deposit
}
```

Room stat entries with `status: 'out of borders'` are outside the playable map boundary. The `users` map contains profile data for every user referenced by `own.user` across all returned room stats — resolved in a single response so no follow-up requests are needed.

#### `roomsTerrain` detail

Fetches digit-encoded terrain strings for multiple rooms in a single POST request. More efficient than calling `roomTerrain` per room when loading a map overview.

```ts
const result = await client.http.game.roomsTerrain(
  ['W6N0', 'W6S0'],
  'shard0',  // optional, default 'shard0'
)
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `rooms` | `string[]` | Room names to fetch terrain for. |
| `shard` | `string` | Shard name. Defaults to `'shard0'`. |

**Response shape** (`ApiGameRoomsResponse`)

```ts
interface ApiGameRoomsResponse {
  ok: number
  rooms: Array<{
    _id: string    // internal room document ID
    room: string   // room name (e.g. 'W6N0')
    terrain: string // 2500-char string, one digit per tile: '0'=plain '1'=wall '2'=swamp '3'=swamp+wall
  }>
}
```

The terrain string is always digit-encoded (`encoded=true` is sent automatically). Each character maps to a tile at index `y * 50 + x`. To decode it into a `RoomTerrain`, pass it to `RoomTerrain.fromEncodedString(terrain.terrain)`.

> **Note**: `shard` and `encoded` are sent as URL query parameters; `rooms` is the POST body. The library handles this split automatically.

### `client.http.user`

```ts
http.user.branches(): Promise<ApiUserBranchesResponse>
http.user.code.get(branch): Promise<unknown>
http.user.code.set(branch, modules): Promise<unknown>
http.user.memory.get(path, shard?): Promise<{ ok, data }>
http.user.memory.set(path, value, shard?): Promise<unknown>
http.user.memory.segment.get(segment, shard?): Promise<{ ok, data: string }>
http.user.memory.segment.set(segment, data, shard?): Promise<unknown>
http.user.console(expression, shard?): Promise<unknown>
http.user.stats(interval): Promise<unknown>
http.user.rooms(userId): Promise<unknown>
http.user.overview(interval, statName): Promise<unknown>
http.user.worldStatus(): Promise<{ ok, status: 'normal' | 'lost' | 'empty' }>
http.user.worldStartRoom(shard?): Promise<unknown>
```

### `client.http.leaderboard`

```ts
http.leaderboard.list(limit?, mode?, offset?, season?): Promise<ApiLeaderboardListResponse>
http.leaderboard.find(username, mode?, season?): Promise<unknown>
http.leaderboard.seasons(): Promise<ApiLeaderboardSeasonsResponse>
```

### `client.http.experimental`

```ts
http.experimental.pvp(interval?): Promise<unknown>
http.experimental.nukes(): Promise<unknown>
```

### Rate Limits

```ts
const info = client.http.rateLimits.get('/api/game/room-terrain')
// { limit: number, remaining: number, reset: number }
```

Rate limit headers are tracked automatically per path and exposed on `client.http.rateLimits`.

### Low-level requests

```ts
client.http.request<T>(method, path, body?): Promise<T>
```

Sends an authenticated HTTP request. Handles token refresh on 401, gzip decompression of `data` fields, and rate-limit tracking.

---

## Storage

Persistent storage is optional and uses a binary `StorageAdapter` interface. Keys are automatically namespaced by the server URL hostname to prevent collisions between servers.

### IndexedDBStorage (browser)

```ts
import { IndexedDBStorage } from 'screeps-connectivity'

new IndexedDBStorage('my-app') // opens IndexedDB: "screeps:my-app"
```

### FileStorage (Node.js)

```ts
import { FileStorage } from 'screeps-connectivity/file-storage'

new FileStorage('./cache', 'screeps.com') // stores files in ./cache/screeps.com/
```

### NullStorage

Satisfies the interface without storing anything — useful in tests:

```ts
import { NullStorage } from 'screeps-connectivity'

new ScreepsClient({ ..., storage: new NullStorage() })
```

Alternatively, pass `storage: null` to disable persistence entirely.

### Custom StorageAdapter

```ts
import type { StorageAdapter } from 'screeps-connectivity'

class MyStorage implements StorageAdapter {
  async get(key: string): Promise<Uint8Array | null> { ... }
  async set(key: string, data: Uint8Array): Promise<void> { ... }
  async delete(key: string): Promise<void> { ... }
  async clear(): Promise<void> { ... }
}
```

All values are raw `Uint8Array` — the library stores terrain as binary (no JSON/base64 overhead).

---

## Logging

Debug logging is disabled by default. Enable it via the `debug` option in `ScreepsClientOptions`:

```ts
// Use console.debug with [screeps:namespace] prefixes
new ScreepsClient({ ..., debug: true })

// Use a custom log function
new ScreepsClient({ ..., debug: (msg, ...args) => myLogger.debug(msg, ...args) })

// Enable in dev mode only (Vite)
new ScreepsClient({ ..., debug: import.meta.env.DEV })
```

Each component logs under its own namespace:

| Namespace | What is logged |
|---|---|
| `[screeps:client]` | init, connect, disconnect |
| `[screeps:http]` | authenticate, each request (method + path) |
| `[screeps:socket]` | connect/disconnect, WebSocket open/close/auth, subscribe/unsubscribe with ref-counts, reconnect attempts |
| `[screeps:room]` | subscribe/unsubscribe with ref-counts, terrain cache hit/miss/fetch, `on`/`off` event listeners |
| `[screeps:user]` | subscribe/unsubscribe channels, `me()` fetch, `on`/`off` event listeners |
| `[screeps:server]` | `on`/`off` event listeners |

Sample output:

```
[screeps:client] init https://screeps.com
[screeps:client] connect
[screeps:http] authenticate
[screeps:http] GET /api/auth/query-token
[screeps:http] authenticated
[screeps:socket] connect wss://screeps.com/socket/websocket
[screeps:socket] WebSocket opened
[screeps:socket] auth ok
[screeps:http] GET /api/auth/me
[screeps:user] fetch me
[screeps:http] GET /api/version
[screeps:room] subscribe W7N7 shard0 (refs: 1)
[screeps:socket] subscribe room:shard0/W7N7
```

`Logger` and `LogFn` are exported if you need to reference the types:

```ts
import type { LogFn } from 'screeps-connectivity'
```

---

## Types Reference

### `UserInfo`

```ts
interface UserInfo {
  _id: string
  username: string
  email: string
  cpu: number       // CPU limit in ms per tick
  gcl: number       // Global Control Level points
  credits: number
  badge: Badge
}
```

### `CpuStats`

```ts
interface CpuStats {
  cpu: number       // CPU used this tick (ms)
  memory: number    // Heap memory used (bytes)
}
```

### `ConsoleMessage`

```ts
interface ConsoleMessage {
  log: string[]     // console.log() output lines (may contain HTML)
  results: string[] // expression evaluation results
}
```

### `ServerVersion`

```ts
interface ServerVersion {
  ok: number
  package: number
  protocol: number
  users: number
  serverData: {
    historyChunkSize: number
    features: Array<{ name: string }>
    shards: string[]   // empty on private servers
  }
}
```

### `ShardInfo`

```ts
interface ShardInfo {
  name: string
  lastTicks: number[]
  cpuLimit: number
  rooms: number
  users: number
  tick: number
}
```

### `WorldInfo`

Describes the playable area of a shard. Coordinates use the internal system where `W0 = x = -1`, `E0 = x = 0`, `N0 = y = -1`, `S0 = y = 0` — matching the output of a `parseRoomName` helper that avoids the `-0 === 0` ambiguity.

```ts
interface WorldInfo {
  shard: string | null   // shard name, or null if not applicable (private server)
  width: number          // raw value from /api/game/world-size
  height: number
  minX: number           // smallest valid x coordinate (inclusive)
  maxX: number           // largest  valid x coordinate (inclusive)
  minY: number
  maxY: number
}
```

**Coordinate system note** — the numeric coordinates are produced by the offset convention where `W(n) → -(n+1)` and `E(n) → n`, so that W0 and E0 never collide at zero:

| Room | x | Room | y |
|------|---|------|---|
| W0   | −1 | N0  | −1 |
| W1   | −2 | N1  | −2 |
| W10  | −11 | N10 | −11 |
| E0   |  0 | S0  |  0 |
| E9   |  9 | S9  |  9 |

For a private server that only occupies the W/N quadrant (the most common setup), `minX = −width`, `maxX = −1`, `minY = −height`, `maxY = −1`.

### `RoomTerrain`

```ts
class RoomTerrain {
  readonly raw: Uint8Array          // 2500 bytes, one per tile
  get(x: number, y: number): TerrainType
  static fromEncodedString(encoded: string): RoomTerrain
}

enum TerrainType { Plain = 0, Wall = 1, Swamp = 2 }
```

### `RoomMap2Data`

Low-detail map snapshot delivered by the `roomMap2` WebSocket channel each tick. All 8 fixed keys are always present (empty array when nothing is present). Keys beyond the 8 known ones are user IDs.

```ts
interface RoomMap2Data {
  w:  [number, number][]   // player-built walls / ramparts
  r:  [number, number][]   // roads
  pb: [number, number][]   // power banks / power
  p:  [number, number][]   // portals
  s:  [number, number][]   // sources
  c:  [number, number][]   // controllers
  m:  [number, number][]   // minerals
  k:  [number, number][]   // source keeper lairs
  [userId: string]: [number, number][]  // structures + creeps for that user
}
```

Each `[number, number]` is `[x, y]`. Channel name: `roomMap2:{shard}/{room}` (sharded) or `roomMap2:{room}` (private server).

**Example — map overview layer**:
```ts
const sub = client.stores.room.subscribeMap2('E9N3', 'shard0')
client.stores.room.on('room:map2update', ({ room, data }) => {
  renderRoads(room, data.r)
  renderSources(room, data.s)
  for (const [userId, positions] of Object.entries(data)) {
    if (!['w','r','pb','p','s','c','m','k'].includes(userId)) {
      renderUserPresence(room, userId, positions)
    }
  }
})
```

---

### `RoomObject` / `RoomObjectMap` / `RoomObjectDiff`

```ts
interface RoomObject {
  _id: string
  type: string
  room: string
  x: number
  y: number
  [key: string]: unknown  // type-specific fields (energy, hits, actionLog, etc.)
}

type RoomObjectMap  = Record<string, RoomObject>           // complete merged state
type RoomObjectDiff = Record<string, Partial<RoomObject> | null>  // per-tick changes; null = deleted
```

### `Subscription` / `SubscriptionGroup`

```ts
interface Subscription {
  dispose(): void
}

class SubscriptionGroup implements Subscription {
  add(sub: Subscription): void
  dispose(): void   // disposes all added subscriptions
}
```
