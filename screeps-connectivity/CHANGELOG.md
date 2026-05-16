# Changelog

## Unreleased

### Breaking Changes

- **`RoomStore.subscribeMap2()` removed** — use `client.stores.map.subscribeMap2()` instead.
- **`RoomStore.map2data()` removed** — use `client.stores.map.map2data()` instead.
- **`room:map2update` event moved from `RoomStore` to `MapStore`** — update `store.on('room:map2update', ...)` calls to use `client.stores.map.on('room:map2update', ...)`. The payload now includes a `source: 'live' | 'cache'` field.

### New Features

#### `MapStore` (`client.stores.map`)

- `subscribeMap2(room, shard)` returns a `Map2Subscription` with `status()`, `cachedData()`, and `onStatusChange()`.
- Configurable subscription limit via `ScreepsClientOptions.map2.maxSubscriptions` (default 500). Rooms beyond the limit are placed on a FIFO waitlist and promoted automatically as slots free.
- Diff detection: identical successive server messages do not emit `room:map2update`.
- `room:map2update` event now carries `source: 'live' | 'cache'`. On subscribe, cached data is emitted immediately (microtask) with `source: 'cache'` so subscribers can render stale state before the first live tick arrives.
- `room:map2state` event emitted when a room transitions between `'pending'` and `'active'`, including on WebSocket reconnect.
- Persistent two-tier cache via `Map2Storage` (memory + IndexedDB). Up to `map2.maxCacheEntries` rooms cached with LRU eviction (default 10 000).
- Automatic reconnect handling: all active and pending subscriptions re-emit `room:map2state` after reconnect.

#### `NavigationStore` (`client.stores.navigation`)

- `navigateTo(room, shard)` — append to bounded history (default 50 entries).
- `back()` / `forward()` — move within history; return `false` at boundaries.
- `canBack()` / `canForward()` — synchronous state queries for enabling/disabling UI buttons.
- `current()` — snapshot of current room, shard, index, and history.
- `navigation:change` event emitted on every navigation action.

#### `ScreepsClientOptions`

- New `map2` option: `{ maxSubscriptions?: number; maxCacheEntries?: number }`.
