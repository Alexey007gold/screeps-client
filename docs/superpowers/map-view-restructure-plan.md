# Map View Restructure — Implementation Plan

**Status:** Planned (not started)
**Target executor:** Sonnet model
**Created:** 2026-05-16

## 1. Goals

Move all heavy-lifting for the map view (`MapViewer.tsx`) out of the client and into `screeps-connectivity`. The library becomes the single source of truth for:

1. Active `roomMap2` subscriptions and ref-counting (already done — needs to be extracted into a dedicated `MapStore`)
2. In-memory + IndexedDB persistence of received map2 data per room
3. Diff detection — no event is emitted to the client if the data for a room has not changed since the last tick
4. A configurable subscription limit (default **500**) with a FIFO **waitlist** that auto-promotes rooms when slots free up
5. Synchronous **cache warm-start** so subscribers immediately see the last known state (even if the room is on the waitlist)
6. Automatic re-subscription of active + waitlist rooms after WebSocket reconnect
7. LRU cache eviction (max **10000** rooms persisted per server namespace)

In addition, the navigation surface is updated to take advantage of the new library state.

## 2. Architecture Overview

### Before (current)

```
RoomStore
├─ roomMap2: Map<string, RoomMap2Data>            # in-memory only, no persistence
├─ roomMap2SubCount: Map<string, number>          # ref-count
├─ subscribeMap2()                                 # forwards every server message to client
└─ emit('room:map2update', ...)                    # fired on every server message

MapViewer.tsx (client)
├─ MAP2_ROOM_LIMIT = 5000                          # hardcoded client-side limit
├─ Zoom-gated subscriptions                        # only subscribe when zoom >= 0.4
├─ map2Subs: Map<string, Subscription>             # one sub per room, manually managed
└─ on 'room:map2update': renderer.setRoomMap2()    # fires on every tick for every room
```

### After

```
MapStore (new — owns all map2 state)
├─ uses Map2Storage (memory + IndexedDB, LRU, namespaced by server hostname)
├─ active: Map<key, ActiveEntry>                   # currently subscribed via WS
├─ waitlist: Array<{ room, shard, refCount }>      # FIFO queue
├─ maxSubscriptions: number (default 500)
├─ subscribeMap2() → Map2Subscription              # extended subscription with status
├─ emits 'room:map2update' only on data change     # diff detection
├─ emits 'room:map2state' on pending/active change # status updates
└─ auto-resubscribes on SocketClient reconnect

Map2Storage
├─ memory: Map<key, CachedEntry>                   # hot cache (always loaded)
├─ persistent: StorageAdapter (IndexedDB)
├─ LRU eviction at maxEntries (default 10000)
└─ namespaced under cache.map2/ prefix

MapViewer.tsx (client)
├─ Subscribes all viewport rooms; library decides who is active vs pending
├─ Renders cached data immediately (source: 'cache')
├─ Renders fresh data on update (source: 'live')
├─ Shows visual hint for pending rooms (e.g. dimmed overlay)
└─ NO more client-side limit / zoom-gated subscription bookkeeping

NavigationStore (new — optional but recommended)
├─ currentRoom, currentShard signals
├─ history: bounded ring buffer (back / forward)
└─ Wraps validation against worldBounds
```

## 3. New Files & Modules

### 3.1 `screeps-connectivity/src/stores/MapStore.ts` (NEW)

The core new module. Owns map2 state, subscriptions, waitlist, diff detection.

```typescript
import { TypedStore } from './TypedStore.js'
import { SocketClient } from '../socket/SocketClient.js'
import { Map2Storage } from '../cache/Map2Storage.js'
import { Subscription } from '../subscription/index.js'
import { RoomMap2Data } from '../types/game.js'

export type Map2SubscriptionStatus = 'pending' | 'active'

export interface Map2Subscription extends Subscription {
  /** Reactive read of the current subscription state. */
  readonly status: () => Map2SubscriptionStatus
  /** Last data the library has (cached or live). */
  readonly cachedData: () => RoomMap2Data | null
  /** Subscribe to subscription status changes (pending <-> active). */
  onStatusChange(handler: (status: Map2SubscriptionStatus) => void): Subscription
}

export interface MapStoreEvents {
  'room:map2update': {
    room: string
    shard: string | null
    data: RoomMap2Data
    /** 'cache' = served from in-memory or IndexedDB; 'live' = fresh from WebSocket */
    source: 'cache' | 'live'
  }
  'room:map2state': {
    room: string
    shard: string | null
    status: Map2SubscriptionStatus
  }
}

export interface MapStoreOptions {
  socket: SocketClient
  storage: StorageAdapter | null
  namespace: string                  // server hostname
  maxSubscriptions?: number          // default 500
  maxCacheEntries?: number           // default 10000
}

export class MapStore extends TypedStore<MapStoreEvents> {
  // Implementation: see Phase 1-4 below
}
```

### 3.2 `screeps-connectivity/src/cache/Map2Storage.ts` (NEW)

Specialized two-tier storage with LRU eviction for map2 data.

```typescript
import { StorageAdapter } from '../storage/StorageAdapter.js'
import { RoomMap2Data } from '../types/game.js'

interface CachedEntry {
  data: RoomMap2Data
  lastSeen: number       // gameTime or wall-clock when last received
  lastAccess: number     // updated on read; used for LRU eviction
}

export interface Map2StorageOptions {
  adapter: StorageAdapter | null
  namespace: string      // e.g. 'screeps.com'
  maxEntries: number     // default 10000
}

export class Map2Storage {
  private readonly memory = new Map<string, CachedEntry>()
  private readonly adapter: StorageAdapter | null
  private readonly maxEntries: number
  private readonly prefix: string  // e.g. 'map2/'

  constructor(opts: Map2StorageOptions) { ... }

  /** Synchronous read from memory only. */
  getMemory(room: string, shard: string | null): RoomMap2Data | null

  /** Async read; falls back to IndexedDB if not in memory and hydrates memory. */
  get(room: string, shard: string | null): Promise<RoomMap2Data | null>

  /** Write both memory and IndexedDB; triggers LRU eviction if over limit. */
  put(room: string, shard: string | null, data: RoomMap2Data): Promise<void>

  delete(room: string, shard: string | null): Promise<void>

  /** Eagerly load most-recent N entries into memory at startup (optional). */
  warmUp(limit: number): Promise<void>

  /** Run LRU eviction down to maxEntries; returns count evicted. */
  pruneToLimit(): Promise<number>
}
```

**Storage format on IndexedDB:**
- Key: `map2/${shard ?? '_'}/${room}` (e.g. `map2/shard0/W7N7`)
- Value: JSON-encoded `{ data: RoomMap2Data, lastSeen: number, lastAccess: number }` as `Uint8Array` (via `TextEncoder`)
- Reuses existing `IndexedDBStorage` (no schema changes needed)

For LRU we keep an in-memory index `{ key, lastAccess }[]` to avoid scanning IndexedDB on every put. The index is reconstructed at startup by enumerating all `map2/` keys lazily.

### 3.3 `screeps-connectivity/src/stores/NavigationStore.ts` (NEW, optional)

A small store that holds current room/shard + navigation history. Replaces the ad-hoc navigation state currently spread across `MapViewer.tsx` and `RoomViewer.tsx`.

```typescript
export interface NavigationState {
  room: string | null
  shard: string | null
  index: number          // index into history
  history: Array<{ room: string; shard: string | null }>
}

export interface NavigationStoreEvents {
  'navigation:change': NavigationState
}

export class NavigationStore extends TypedStore<NavigationStoreEvents> {
  navigateTo(room: string, shard: string | null): void
  back(): boolean
  forward(): boolean
  canBack(): boolean
  canForward(): boolean
  current(): NavigationState
}
```

History is bounded (default 50 entries). Used by the new back/forward UI in the client.

### 3.4 `screeps-connectivity/src/ScreepsClient.ts` (MODIFY)

Wire up MapStore + NavigationStore. Add config options.

```typescript
export interface ScreepsClientOptions {
  // existing options...
  map2?: {
    maxSubscriptions?: number   // default 500
    maxCacheEntries?: number    // default 10000
  }
}

class ScreepsClient {
  // ...
  readonly stores: {
    room: RoomStore
    user: UserStore
    server: ServerStore
    map: MapStore            // NEW
    navigation: NavigationStore  // NEW
  }
}
```

### 3.5 `screeps-connectivity/src/stores/RoomStore.ts` (MODIFY)

Remove all map2 state and methods:

- Delete `roomMap2`, `roomMap2SubCount` fields
- Delete `subscribeMap2()`, `map2data()` methods
- Delete `'room:map2update'` from events type

Update the doc comment to note that `roomMap2` is now owned by `MapStore`. This is a **breaking change** — bump the version of `screeps-connectivity` accordingly. Since the only known consumer is `screeps-client`, the migration is done in-tree.

### 3.6 `screeps-connectivity/src/types/events.ts` (MODIFY)

Move `room:map2update` event type out of RoomStore events and into the new MapStore events block.

## 4. Detailed Behavior

### 4.1 Subscribe flow

```
client.stores.map.subscribeMap2('W7N7', 'shard0')
  │
  ├─→ key = 'shard0/W7N7'
  │
  ├─→ Is key already active? Increment refCount, return Map2Subscription{status: 'active'}.
  │   Cached data may exist; emit a 'room:map2update' with source='cache' on next microtask.
  │
  ├─→ Is key already pending? Increment refCount, return Map2Subscription{status: 'pending'}.
  │   Emit cached data (source='cache') if available.
  │
  ├─→ Else: are active.size < maxSubscriptions?
  │     YES → activate immediately:
  │             • active.set(key, { refCount: 1, socketSub, listenerSub })
  │             • Open underlying WS subscription via SocketClient.subscribe(channel)
  │             • Emit 'room:map2state' { status: 'active' }
  │             • If cached data → emit 'room:map2update' { source: 'cache' } on next microtask
  │     NO  → enqueue on waitlist:
  │             • waitlist.push({ key, refCount: 1 })
  │             • Emit 'room:map2state' { status: 'pending' }
  │             • If cached data → emit 'room:map2update' { source: 'cache' } on next microtask
  │
  └─→ Return Map2Subscription with reactive status() and onStatusChange()
```

### 4.2 Unsubscribe flow

```
sub.dispose()
  │
  ├─→ Is key on the waitlist? Decrement refCount.
  │     If refCount reached 0: remove from waitlist.
  │     (No promotion needed — slot was never occupied.)
  │
  ├─→ Is key active? Decrement refCount.
  │     If refCount reached 0:
  │       • Dispose socketSub and listenerSub
  │       • Remove from active
  │       • PROMOTE next waitlist entry (FIFO):
  │           ─ shift from waitlist
  │           ─ active.set(key, ...)
  │           ─ Open WS subscription
  │           ─ Emit 'room:map2state' { status: 'active' } for that room
  │
  └─→ Subsequent calls to dispose() are no-ops (idempotent)
```

### 4.3 Incoming map2 message handler

```
onChannelMessage(channel, data):
  │
  ├─→ key = parseKey(channel)
  ├─→ const next = data as RoomMap2Data
  ├─→ const prev = storage.getMemory(room, shard)
  ├─→ if (prev && deepEquals(prev, next)) {
  │     // No change — still update lastSeen but do NOT emit
  │     storage.touchLastSeen(key)
  │     return
  │   }
  ├─→ await storage.put(room, shard, next)   // updates memory + persists
  └─→ emit('room:map2update', { room, shard, data: next, source: 'live' })
```

**`deepEquals(prev, next)`**: For map2 data we use a canonical-form JSON stringify comparison. Implementation:

```typescript
function canonicalize(data: RoomMap2Data): string {
  const sortedKeys = Object.keys(data).sort()
  const obj: Record<string, [number, number][] | null> = {}
  for (const k of sortedKeys) {
    const v = data[k]
    obj[k] = v ? [...v].sort((a, b) => a[0] - b[0] || a[1] - b[1]) : null
  }
  return JSON.stringify(obj)
}
function deepEquals(a: RoomMap2Data, b: RoomMap2Data): boolean {
  return canonicalize(a) === canonicalize(b)
}
```

Performance note: map2 payloads are typically <1KB. Canonicalize is O(n log n) where n ≈ tens to low hundreds of entries. This runs once per server message per room — acceptable.

Optimization (Phase 7 if needed): cache the canonicalized string alongside the cached entry to avoid re-canonicalizing `prev` on every message.

### 4.4 Cache warm-start

The user's spec says: *"er bekommt aber mit dem nächsten tick den letzten gespeicherten stand"* (the client gets the last saved state with the next tick).

We interpret this generously: **emit cached data immediately after subscribe**, regardless of whether the room is on the waitlist or active. The emission is scheduled on a microtask (`queueMicrotask`) so the subscriber gets the chance to attach handlers first:

```typescript
subscribeMap2(room, shard) {
  // ... bookkeeping ...
  const cached = this.storage.getMemory(room, shard)
  if (cached) {
    queueMicrotask(() => {
      this.emit('room:map2update', { room, shard, data: cached, source: 'cache' })
    })
  }
  // ...
}
```

If memory cache miss but IndexedDB has the entry, do an async read in the background and emit when ready:

```typescript
if (!cached) {
  this.storage.get(room, shard).then((data) => {
    if (data && this.isStillSubscribed(room, shard)) {
      this.emit('room:map2update', { room, shard, data, source: 'cache' })
    }
  })
}
```

### 4.5 Reconnect handling

`SocketClient` already has a `'connect'` event (verify in `SocketClient.ts`). MapStore listens for it and:

1. Re-opens WS subscriptions for every active key
2. Re-evaluates the waitlist (no-op normally; ensures internal consistency)
3. Cached data remains untouched

Note: existing `RoomStore` already does something similar for `room:update`. Cross-reference its pattern when implementing.

### 4.6 LRU eviction

After every `storage.put()`:

```typescript
if (this.memory.size > this.maxEntries) {
  // Find N oldest by lastAccess
  const entries = [...this.memory.entries()]
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess)
  const toEvict = entries.slice(0, this.memory.size - this.maxEntries)
  for (const [key] of toEvict) {
    this.memory.delete(key)
    await this.adapter?.delete(this.prefix + key)
  }
}
```

For 10000 rooms × ~1KB per entry, this gives an upper bound of ~10MB in memory + ~10MB in IndexedDB. Eviction cost is amortized O(n log n) but only runs when the cap is exceeded.

**Eviction-friendly optimization**: keep a sorted index by lastAccess (a simple sorted array or min-heap). Update on touch. Skip this optimization unless profiling shows it matters.

### 4.7 Subscription limit warning

When `subscribeMap2()` places a room on the waitlist, the library does **not** throw — it just returns a `Map2Subscription` with `status: 'pending'`. The caller learns about the limit via:

1. The initial `status()` value (synchronous, available immediately after subscribe returns)
2. The `'room:map2state'` event with `status: 'pending'`

The library should also expose a console warning (one-shot per session) so developers notice the limit without active inspection:

```typescript
if (this.warnedAboutWaitlist === false && this.waitlist.length > 0) {
  console.warn(
    `[MapStore] Subscription limit (${this.maxSubscriptions}) reached. ` +
    `Some rooms are on a waitlist and will be promoted as slots free up.`
  )
  this.warnedAboutWaitlist = true
}
```

## 5. Client Migration (`screeps-client/`)

### 5.1 `MapViewer.tsx` — simplify

Current logic (Zeile 288-314) to **remove**:

```typescript
const MAP2_ROOM_LIMIT = 5000
const subsActive = rooms.length > 0 && rooms.length <= MAP2_ROOM_LIMIT && zoom() >= 0.4
// ...all the manual subscription bookkeeping
```

Replace with:

```typescript
const c = client()
if (!c) return

// Just subscribe to every visible room — MapStore handles limits and lifecycle
const subs = new Map<string, Map2Subscription>()
for (const room of rooms) {
  const key = `${room}/${shard}`
  if (!subs.has(key)) {
    subs.set(key, c.stores.map.subscribeMap2(room, shard))
  }
}
// Dispose subs for rooms that left the viewport
for (const [key, sub] of subs) {
  if (!rooms.some(r => `${r}/${shard}` === key)) {
    sub.dispose()
    subs.delete(key)
    renderer?.clearRoomMap2(key.split('/')[0])
  }
}
```

The zoom-gating logic can be kept if desired (the user may want to skip subscribing at very low zoom to save memory), but it's no longer required for correctness.

### 5.2 `MapViewer.tsx` — listen to MapStore events

```typescript
const sub = c.stores.map.on('room:map2update', ({ room, shard, data, source }) => {
  if (shard !== props.shard) return
  renderer?.setRoomMap2(room, data, source)   // pass source for styling
})
```

Add a second listener for `room:map2state` to update a "pending rooms" overlay:

```typescript
const subState = c.stores.map.on('room:map2state', ({ room, shard, status }) => {
  if (shard !== props.shard) return
  renderer?.setRoomSubscriptionStatus(room, status)
})
```

### 5.3 `MapRenderer.ts` — visual hint for pending and cached rooms

Add optional fade/desaturation when:

- `source === 'cache'` and no live update has arrived yet → render with reduced opacity (e.g. `0.6`)
- `status === 'pending'` → small "waiting" indicator in the corner (optional)
- `status === 'active'` and last data was live → full opacity

Implementation: add a per-room mode flag to `RoomMapEntry`, update in `setRoomMap2(name, data, source)` and `setRoomSubscriptionStatus(name, status)`, and re-render `map2Graphics` with `alpha` set on the container.

### 5.4 `Dashboard.tsx` and friends — auto-connect remains unchanged

The auto-connect logic in `clientStore.ts` and `App.tsx` is unaffected. MapStore is constructed inside `ScreepsClient` and ready as soon as `connect()` resolves.

## 6. Navigation Improvements

Since the user has no specific preference, this plan includes **four navigation improvements** ordered by impact. They can be implemented selectively.

### 6.1 (RECOMMENDED) Click-to-navigate from map view

In `MapViewer.tsx`, wire pointer-click on a room cell to `props.onNavigateToRoom`. The renderer already has hover detection (`onHoveredRoomChanged`); add a click handler that:

1. Resolves the clicked grid coordinate to a room name
2. Validates against `worldBounds()`
3. Calls `props.onNavigateToRoom(room, shard)`

### 6.2 NavigationStore + back/forward

Add `NavigationStore` (see §3.3) to `screeps-connectivity`. Wire it into `clientStore.ts`:

```typescript
function navigateTo(room: string, shard: string | null) {
  client()?.stores.navigation.navigateTo(room, shard)
}
```

UI changes:
- New `<NavBar>` component with back/forward arrow buttons
- Buttons reflect `canBack()` / `canForward()` reactively via Solid signal derived from `'navigation:change'` event

### 6.3 Search / Jump-to-Room

Extend `RoomNavigator.tsx`:
- Add an input field with debounced auto-validation against `worldBounds()`
- Show "invalid room" hint if outside bounds
- Submit Enter → `navigation.navigateTo()`

### 6.4 Keyboard shortcuts consolidation

Currently arrow keys + `m` are duplicated in `MapViewer.tsx` and `RoomViewer.tsx`. Extract a `useRoomNavigationKeys()` hook (Solid composable) that takes the navigation store and binds keys at the document level.

## 7. Tests

Tests live in `screeps-connectivity/tests/`, mirroring `src/`. Add the following:

### 7.1 `tests/stores/MapStore.test.ts`

Critical paths:

- `subscribeMap2()` returns active subscription when under limit
- `subscribeMap2()` returns pending subscription at limit
- Unsubscribing an active room promotes the next waitlist entry
- Unsubscribing a waitlist room does NOT trigger promotion
- Diff detection: identical successive messages do NOT emit `room:map2update`
- Diff detection: changed messages DO emit `room:map2update` with `source: 'live'`
- Subscribe with cached data emits `'room:map2update'` with `source: 'cache'` on microtask
- Auto-resubscribe on socket reconnect
- Ref-counting: multiple subscribes to same room share one WS subscription

Use a `FakeSocketClient` (similar to existing patterns) that exposes `simulateMessage(channel, data)`, `simulateReconnect()`, etc.

### 7.2 `tests/cache/Map2Storage.test.ts`

- Memory-only read returns null if not loaded
- Async read hydrates memory from IndexedDB (use `fake-indexeddb`)
- Put writes both memory and IndexedDB
- LRU eviction: putting `maxEntries + 1` items evicts the least-recently-accessed
- Touching an entry resets its lastAccess timestamp
- Namespacing isolates different server hostnames

### 7.3 `tests/stores/NavigationStore.test.ts` (if implementing 6.2)

- `navigateTo()` appends to history and emits change
- `back()` / `forward()` move within history without appending
- `navigateTo()` after `back()` truncates forward history
- History is bounded to maxEntries

## 8. Implementation Phases

Each phase is a self-contained PR-sized chunk. Run `pnpm test` + `pnpm lint` after each phase before moving on.

### Phase 1 — MapStore skeleton, diff detection (~half a day)

- Create `MapStore.ts` (in-memory only, no persistence yet)
- Create `Map2Storage.ts` with memory-only path; adapter param accepted but unused
- Move `subscribeMap2()`, `map2data()`, `roomMap2*` fields from `RoomStore` to `MapStore`
- Implement diff detection (canonical-form equality)
- Wire `MapStore` into `ScreepsClient`
- Update `screeps-client/MapViewer.tsx` to use `client.stores.map.subscribeMap2` (no behavioral change yet)
- Update tests

### Phase 2 — Persistent cache + warm-start (~half a day)

- Wire `Map2Storage` to `IndexedDBStorage`
- Implement async `get()` path and microtask emission for cache hits
- Implement LRU eviction
- Add `source: 'live' | 'cache'` field to `room:map2update` event
- Update `MapRenderer.setRoomMap2()` to optionally dim cached data
- Tests for Map2Storage

### Phase 3 — Subscription limit + waitlist (~half a day)

- Add `maxSubscriptions` option (default 500)
- Implement waitlist FIFO queue + promotion on unsubscribe
- Implement `Map2Subscription.status` + `onStatusChange`
- Implement `'room:map2state'` events
- Remove `MAP2_ROOM_LIMIT = 5000` from `MapViewer.tsx`
- Optional: add UI overlay showing pending count
- Tests for waitlist + promotion

### Phase 4 — Reconnect handling (~quarter day)

- Listen for `SocketClient` reconnect event in `MapStore`
- Re-open WS subs for every active key
- Re-emit `'room:map2state'` events to confirm to consumers
- Tests for reconnect behavior

### Phase 5 — Navigation: click-to-navigate (~quarter day)

- Add pointer-click handler in `MapRenderer` and surface via `MapViewer` callback
- Wire to existing `props.onNavigateToRoom`
- Manual test in browser

### Phase 6 — Navigation: NavigationStore + back/forward (~half a day)

- Create `NavigationStore` with bounded history
- Wire into `ScreepsClient`
- Update `clientStore.ts` to use it
- Add back/forward UI to header
- Tests for NavigationStore

### Phase 7 — Navigation: search + keyboard consolidation (~half a day)

- Extend `RoomNavigator` with debounced auto-complete
- Extract `useRoomNavigationKeys()` hook
- Replace duplicated key handlers in `MapViewer` and `RoomViewer`

### Phase 8 — Docs (~quarter day)

- Update `docs/screeps-connectivity.md`:
  - Add `MapStore` section after `RoomStore`
  - Add `NavigationStore` section
  - Update example for map2 to use new API
  - Note breaking change in changelog
- Add `CHANGELOG.md` (or extend existing) noting:
  - Breaking: `RoomStore.subscribeMap2` / `map2data` removed
  - Breaking: `room:map2update` moved from RoomStore to MapStore
  - Added: `MapStore`, `Map2Storage`, `NavigationStore`

## 9. Open Questions / Decisions Deferred

These can be answered during implementation:

1. **Cache warm-up at startup**: should `MapStore` proactively load the N most-recently-used entries from IndexedDB on construction, or only lazy-load on subscribe? Recommend lazy-load (simpler, lower startup cost).

2. **`source: 'cache'` styling**: how prominent should the visual "stale" hint be? Could be alpha=0.6, a small clock icon, a desaturation filter, or nothing at all. Decide during Phase 2 visual review.

3. **Waitlist priority hint**: should `subscribeMap2()` accept a `priority` hint (e.g. so the user's selected room jumps the queue)? Out of scope for v1; add if needed.

4. **Cross-server eviction**: should evictions consider all servers' entries together, or only the current server's namespace? Recommend per-namespace (matches current `Cache` semantics).

5. **gameTime tracking**: should we use the server's `gameTime` (from `ServerStore`) as the `lastSeen` value instead of wall-clock? More semantically correct; nice to have but not required.

## 10. Acceptance Criteria

The refactor is "done" when:

- [ ] `RoomStore` has no map2-related code or events
- [ ] `client.stores.map.subscribeMap2()` is the only way to subscribe to map2 data
- [ ] Subscribing to ≤500 rooms results in 500 active WS subscriptions
- [ ] Subscribing to >500 rooms places the excess on a FIFO waitlist; unsubscribing an active room promotes the next pending one
- [ ] Two consecutive identical server messages for the same room produce exactly one `'room:map2update'` event
- [ ] Subscribing a room with cached data produces an immediate `'room:map2update'` with `source: 'cache'`
- [ ] After 10000+ unique rooms have been cached, IndexedDB never holds more than ~10000 entries
- [ ] A WS reconnect re-opens all active subscriptions automatically without client intervention
- [ ] `MapViewer.tsx` no longer references `MAP2_ROOM_LIMIT` or owns subscription accounting beyond viewport-based add/remove
- [ ] All existing tests still pass; new tests cover the cases listed in §7
- [ ] Click on a room in the map view navigates to that room (acceptance for Phase 5)
- [ ] Back/forward navigation buttons work and reflect history state (acceptance for Phase 6)
