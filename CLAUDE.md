# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

Monorepo with two active packages and a `reference/` directory containing third-party source for reference only (do not edit):

- `screeps-connectivity/` — core TypeScript library: HTTP, WebSocket, stores, cache, storage
- `screeps-client/` — SolidJS + PixiJS browser frontend that consumes `screeps-connectivity`
- `docs/screeps-connectivity.md` — full API reference for the library
- `docs/superpowers/` — design specs and plans (markdown, do not edit generated specs)
- `reference/` — third-party source for reference only, never edit
- `test-live.mjs` — ad-hoc live integration test script (Node.js)

## Commands

### screeps-connectivity (run from `screeps-connectivity/`)

```sh
npm run build       # tsup → dist/ (ESM + CJS + .d.ts)
npm test            # Vitest, single run
npm run test:watch  # Vitest watch mode
npm run lint        # ESLint src + tests
```

Run a single test file:
```sh
npx vitest run tests/socket/SocketClient.test.ts
```

### screeps-client (run from `screeps-client/`)

```sh
npm run dev     # Vite dev server
npm run build   # tsc + vite build
npm run lint    # ESLint src
```

The Vite config aliases `screeps-connectivity` directly to `screeps-connectivity/src/index.ts`, so the library does **not** need to be built before running the dev server.

The path alias `~/` maps to `screeps-client/src/` — use it for all intra-package imports.

## Architecture

### screeps-connectivity

Five layers, each with a single responsibility:

```
ScreepsClient          — facade, wires everything together
  ├─ HttpClient        — fetch wrapper, auth headers, rate limiting, gzip decompression
  │    └─ endpoints/   — auth · game · user · leaderboard · experimental
  └─ SocketClient      — WebSocket lifecycle, reconnect (exponential backoff), sub ref-counting
       └─ MessageParser — plain-text commands and JSON-array messages, gzip via DecompressionStream
DataStores             — RoomStore · UserStore · ServerStore (extend TypedStore → EventTarget)
Cache                  — two-tier: in-memory Map + optional StorageAdapter, namespaced by server hostname
StorageAdapter         — binary interface (Uint8Array); IndexedDBStorage · FileStorage · NullStorage
```

**ScreepsClient** is the only entry point consumers instantiate. `connect()` authenticates via the injected `AuthStrategy`, then opens the WebSocket. The `WebSocket` constructor can be injected for Node 18/20 compatibility.

**Auth strategies** (`TokenAuth`, `PasswordAuth`) implement `AuthStrategy.authenticate(http) → Promise<string>`. Adding a new strategy requires no changes to `HttpClient`.

**DataStores** each extend `TypedStore<EventMap>`, which extends `EventTarget`. Calling `store.on(type, handler)` returns a `Subscription` (`{ dispose() }`). `SubscriptionGroup` composes multiple subscriptions for batch teardown — maps directly to `onCleanup` (SolidJS) or `onDestroy` (Svelte).

**Room objects**: the first WebSocket message for a room is the full state; subsequent messages are diffs. `RoomStore` merges diffs internally so consumers always see complete state.

**Terrain** is stored as `Uint8Array(2500)` — 1 byte per tile (values 0–3) — both in memory and as raw binary in persistent storage. No JSON/base64 overhead.

**Cache namespacing** is derived from the server URL hostname, preventing collisions when connecting to multiple servers.

**HTTP endpoints** are grouped by domain under `HttpClient`:
- `http.auth` — signin, me, queryToken
- `http.game` — room data, game time, shard info
- `http.user` — user profile, console, branches
- `http.leaderboard` — rankings, seasons
- `http.experimental` — experimental API endpoints

### screeps-client

SolidJS app with PixiJS for room rendering.

#### Source structure

```
src/
├── index.tsx              # Entry point: renders <App> into #root
├── app/
│   ├── App.tsx            # Root: auto-connects on mount, switches LoginForm ↔ Dashboard
│   └── Dashboard.tsx      # Main layout: header, room canvas, console panel, sidebar with draggable splitters
├── components/
│   ├── ConnectionStatus.tsx  # Color-coded status chip (idle/connecting/connected/error)
│   ├── ConsolePanel.tsx      # Console I/O: Log and Console tabs, auto-scroll, input form
│   ├── LoginForm.tsx         # Auth form: password or token mode, server URL
│   ├── PixiCanvas.tsx        # Demo PixiJS canvas (tile grid prototype)
│   ├── RoomNavigator.tsx     # Room name + shard input with Load button
│   ├── RoomViewer.tsx        # Ties RoomRenderer to store subscriptions, manages terrain/object layers
│   ├── Sidebar.tsx           # Collapsible right panel (properties placeholder)
│   └── StatsBar.tsx          # Live CPU and memory stats via UserStore subscription
├── renderer/
│   ├── RoomRenderer.ts       # PixiJS Application: draggable/zoomable world container, navigation zones
│   ├── TerrainLayer.ts       # Graphics layer: Plain (grey)/Wall (dark)/Swamp (green) tiles
│   └── ObjectLayer.ts        # Object sprites: creeps, structures; smooth movement via ticker
├── stores/
│   └── clientStore.ts        # SolidJS signals (client, status, error) + connect/disconnect/tryAutoConnect
├── types/
│   └── client.ts             # ClientState, RoomViewState type definitions
└── utils/
    └── roomName.ts           # Parse/format room names (e.g. W7N7 ↔ {x, y} coordinates)
```

**State management**: `clientStore.ts` holds three SolidJS signals (`client`, `status`, `error`) and three functions (`connect`, `disconnect`, `tryAutoConnect`). On connect, credentials are persisted to `localStorage` (`screeps:url`, `screeps:token`) for auto-reconnect on page reload.

**`App.tsx`** calls `tryAutoConnect()` on mount to restore the previous session from `localStorage`. It switches between `<LoginForm>` and `<Dashboard>` based on connection state.

**`Dashboard.tsx`** uses CSS flex layout with draggable splitters. The room canvas is the main content area; `ConsolePanel` sits below it; `Sidebar` is to the right.

**`RoomViewer.tsx`** subscribes to `RoomStore` and `UserStore`, creates `TerrainLayer` and `ObjectLayer`, and hands them to `RoomRenderer`. Handles room navigation triggered from `RoomNavigator`.

**`RoomRenderer.ts`** wraps a PixiJS `Application` in a `world` container with pointer-drag panning and wheel zoom, navigation zones (edge-scroll regions), and a view-reset method.

## Coding Conventions

- TypeScript strict mode, ESM, 2-space indentation, no semicolons
- Named exports throughout; explicit `.js` extensions in TypeScript import specifiers (e.g., `import { Foo } from './Foo.js'`)
- `PascalCase` for classes and files, `camelCase` for functions and variables
- Zero production dependencies in `screeps-connectivity` — use native platform APIs only
- `screeps-connectivity/dist/` is generated — never hand-edit it
- Use `~/` alias for imports within `screeps-client/src/` (e.g. `import { client } from '~/stores/clientStore.js'`)

## Testing

Tests live in `screeps-connectivity/tests/`, mirroring the `src/` layout. `screeps-client` has no test suite currently.

- Run all tests: `npm test` (from `screeps-connectivity/`)
- Run one file: `npx vitest run tests/socket/SocketClient.test.ts`
- Test environment: Node (Vitest); uses `fake-indexeddb` for storage tests
