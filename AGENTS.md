# Repository Guidelines

## Project Structure & Module Organization

Monorepo with two active packages:

- `screeps-connectivity/` — core TypeScript library (HTTP, WebSocket, stores, cache, storage). Zero production dependencies; uses native platform APIs only.
- `screeps-client/` — SolidJS + PixiJS browser frontend that consumes `screeps-connectivity`.
- `docs/screeps-connectivity.md` — full API reference for the library. Keep this up to date when changing public interfaces, event payloads, or store behaviour.
- `docs/superpowers/` — design specs and plans (markdown, do not edit generated specs).
- `reference/` — third-party source for reference only, **never edit**.
- `test-live.mjs` — ad-hoc live integration test script (Node.js).

Keep production code in `screeps-connectivity/src/` and group it by concern: `http/`, `socket/`, `storage/`, `stores/`, `cache/`, and `types/`. Put tests in `screeps-connectivity/tests/`, mirroring the source layout where possible, for example `src/socket/SocketClient.ts` and `tests/socket/SocketClient.test.ts`. Build output goes to `screeps-connectivity/dist/` and should be treated as generated artifacts.

## Build, Test, and Development Commands

### Root (pnpm workspace)

```sh
pnpm dev            # start screeps-client dev server
pnpm build          # build connectivity then client
pnpm test           # run screeps-connectivity tests
pnpm lint           # lint all packages
```

### screeps-connectivity

```sh
cd screeps-connectivity
pnpm build          # tsup → dist/ (ESM + CJS + .d.ts)
pnpm test           # Vitest, single run
pnpm test:watch     # Vitest watch mode
pnpm lint           # ESLint src + tests
npx vitest run tests/socket/SocketClient.test.ts   # single test file
```

### screeps-client

```sh
cd screeps-client
pnpm dev            # Vite dev server
pnpm build          # tsc + vite build
pnpm lint           # ESLint src
```

`screeps-connectivity` is a pnpm workspace dependency. It exposes a `"development"` export condition pointing to its TypeScript source, so the library does **not** need to be built before running the dev server. For production (`pnpm build`), run `pnpm --filter screeps-connectivity build` first (the root `pnpm build` does this automatically).

## Architecture Overview

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

**DataStores** each extend `TypedStore<EventMap>`, which extends `EventTarget`. Calling `store.on(type, handler)` returns a `Subscription` (`{ dispose() }`). `SubscriptionGroup` composes multiple subscriptions for batch teardown.

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

**Source structure** (`screeps-client/src/`):
- `index.tsx` — Entry point: renders `<App>` into `#root`
- `app/App.tsx` — Root: auto-connects on mount, switches LoginForm ↔ Dashboard
- `app/Dashboard.tsx` — Main layout: header, room canvas, console panel, sidebar with draggable splitters
- `components/` — ConnectionStatus, ConsolePanel, LoginForm, PixiCanvas, RoomNavigator, RoomViewer, Sidebar, StatsBar
- `renderer/` — RoomRenderer, TerrainLayer, ObjectLayer, VisualLayer, ActionAnimationLayer, HoverHighlightLayer, BadgeTextureCache, StructureTextureCache, terrainCache, terrain.worker
- `stores/` — clientStore, roomViewStore, roomDataStore, selectionStore, settingsStore, toastStore
- `types/client.ts` — ClientState, RoomViewState type definitions
- `utils/` — roomName parser, useRoomNavigationKeys

**State management**: `clientStore.ts` holds three SolidJS signals (`client`, `status`, `error`) and functions (`connect`, `disconnect`, `tryAutoConnect`). Credentials are persisted to `localStorage` (`screeps:url`, `screeps:token`) for auto-reconnect on page reload. `App.tsx` calls `tryAutoConnect()` on mount.

**`RoomViewer.tsx`** subscribes to `RoomStore` and `UserStore`, creates `TerrainLayer` and `ObjectLayer`, and hands them to `RoomRenderer`.

**`RoomRenderer.ts`** wraps a PixiJS `Application` in a `world` container with pointer-drag panning and wheel zoom, navigation zones (edge-scroll regions), and a view-reset method.

## Coding Style & Naming Conventions

- TypeScript strict mode, ESM, 2-space indentation, no semicolons.
- Named exports throughout; explicit `.js` extensions in TypeScript import specifiers (e.g., `import { Foo } from './Foo.js'`).
- `PascalCase` for classes and files, `camelCase` for functions and variables.
- Zero production dependencies in `screeps-connectivity` — use native platform APIs only.
- `screeps-connectivity/dist/` is generated — never hand-edit it.
- Use `~/` alias for imports within `screeps-client/src/` (e.g., `import { client } from '~/stores/clientStore.js'`).

## Testing Guidelines

Tests live in `screeps-connectivity/tests/`, mirroring the `src/` layout. `screeps-client` has no test suite currently.

- Run all tests: `pnpm test` (from `screeps-connectivity/`)
- Run one file: `npx vitest run tests/socket/SocketClient.test.ts`
- Test environment: Node (Vitest); uses `fake-indexeddb` for storage tests.
- Add tests for every behavioral change and prefer colocated naming by feature, ending with `.test.ts`.
- Cover both success paths and edge cases such as auth failures, socket disconnects, or storage fallbacks.

## Commit & Pull Request Guidelines

Git history is minimal (`initial commit`), so use short, imperative commit subjects going forward, for example `Add token refresh handling`. Keep commits scoped to one change. Pull requests should include a clear summary, note any API or behavior changes, link related issues, and include test evidence (`pnpm test`, `pnpm lint`). Add sample payloads or logs when changing HTTP or socket behavior.

## Generated Files & Dependencies

Do not hand-edit `screeps-connectivity/dist/`. Prefer changes in `src/` and rebuild. Avoid committing incidental edits under `node_modules/`; treat it as local-only workspace state.

## Code-Index Plugin Setup

This project uses the `code-index` MCP plugin for fast codebase exploration. You **must** initialize it at the start of every session before using any of its tools.

### 1. Set Project Path
Call **first**:
```
set_project_path(path: "/Users/bastianh/Development/screeps-client")
```
This performs the shallow file index. Wait for confirmation with file count.

### 2. Build Deep Index
Call **immediately after**:
```
build_deep_index()
```
This extracts all symbols (classes, functions, interfaces, methods) and is **required** for `get_file_summary` and `get_symbol_body`.

### 3. Available Tools

| Tool | Purpose | Key Notes |
|------|---------|-----------|
| `set_project_path` | Set project root & shallow index | **Always call first**. Requires absolute path. |
| `build_deep_index` | Symbol extraction | **Always call after `set_project_path`**. |
| `find_files` | Find files by glob pattern | Uses **relative paths** from project root. E.g. `pattern: "src/**/*.ts"` |
| `search_code_advanced` | Code search with regex/fuzzy | Uses **relative paths**. Results include file, line, snippet. |
| `get_file_summary` | File overview (imports, exports, symbols) | **Use relative paths!** E.g. `file_path: "screeps-connectivity/src/ScreepsClient.ts"` |
| `get_symbol_body` | Source code of a specific symbol | **Use relative paths!** Symbol name must match output from `get_file_summary`. |
| `get_file_watcher_status` | Check watcher status | Shows if index is current and symbol counts. |
| `refresh_index` | Manual rebuild | Use after git operations or if index seems stale. |

### 4. Path Rules
- **`set_project_path`**: Requires **absolute** path.
- **All other tools**: Require **relative** paths from project root.
  - ❌ `/Users/bastianh/project/src/file.ts`
  - ✅ `src/file.ts`

### 5. Recommended Workflow
1. **Initialize**: `set_project_path` → `build_deep_index`
2. **Locate files**: `find_files` or `search_code_advanced`
3. **Analyze file**: `get_file_summary` for overview of imports/exports/symbols
4. **Deep dive**: `get_symbol_body` for exact source of a function/class
5. **Refine**: `search_code_advanced` with `regex: true` for complex patterns

### 6. Example Sequence
```
1. set_project_path(path: "/Users/bastianh/Development/screeps-client")
2. build_deep_index()
3. search_code_advanced(pattern: "class ScreepsClient", max_results: 5)
4. get_file_summary(file_path: "screeps-connectivity/src/ScreepsClient.ts")
5. get_symbol_body(file_path: "screeps-connectivity/src/ScreepsClient.ts", symbol_name: "connect")
```

**Never skip steps 1 and 2.** Without `set_project_path` no tools work. Without `build_deep_index` symbol queries return incomplete or empty results.
