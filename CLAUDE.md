# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

pnpm workspace with four published packages:

- `screeps-connectivity/` — core TypeScript library: HTTP, WebSocket, stores, cache, storage
- `screeps-client/` — SolidJS + PixiJS browser frontend that consumes `screeps-connectivity`
- `screeps-mod-client/` (published as `screepsmod-client-new`) — Screeps server mod, serves the embedded client at `/client`
- `xxscreeps-mod-client/` — xxscreeps mod, serves and wires up the embedded client
- `docs/screeps-connectivity.md` — full API reference for the library
- `docs/superpowers/` — design specs and plans (markdown, do not edit generated specs)
- `test-live.mjs` — ad-hoc live integration test script (Node.js)

## Commands

### Root (pnpm workspace)

```sh
pnpm dev            # start screeps-client dev server
pnpm build          # build connectivity then client
pnpm test           # run screeps-connectivity tests
pnpm lint           # lint all packages
```

### screeps-connectivity (run from `screeps-connectivity/`)

```sh
pnpm build          # tsup → dist/ (ESM + CJS + .d.ts)
pnpm test           # Vitest, single run
pnpm test:watch     # Vitest watch mode
pnpm lint           # ESLint src + tests
```

Run a single test file:
```sh
npx vitest run tests/socket/SocketClient.test.ts
```

### screeps-client (run from `screeps-client/`)

```sh
pnpm dev            # Vite dev server
pnpm build          # tsc + vite build
pnpm lint           # ESLint src
```

`screeps-connectivity` is a pnpm workspace dependency. It exposes a `"development"` export condition pointing to its TypeScript source, so the library does **not** need to be built before running the dev server. For production (`pnpm build`), run `pnpm --filter screeps-connectivity build` first (the root `pnpm build` does this automatically).

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
│   ├── Sidebar/           # index.tsx + BuildPanel, FlagForm, RoomInfoBox subpanels
│   ├── CodePanel.tsx      # Code editor panel (CodeMirror)
│   ├── ConnectionStatus.tsx  # Color-coded status chip (idle/connecting/connected/error)
│   ├── ConsolePanel.tsx   # Console I/O: Log and Console tabs, auto-scroll, input form
│   ├── LoginForm.tsx      # Auth form: password or token mode, server URL, registration
│   ├── MapInfoPanel.tsx   # Map-level info overlay
│   ├── MapViewer.tsx      # World map PixiJS view
│   ├── RoomInfoPanel.tsx  # Selected room info
│   ├── RoomNavigator.tsx  # Room name + shard input with Load button
│   ├── RoomViewer.tsx     # Ties RoomRenderer to store subscriptions
│   ├── SelectionList.tsx  # Object selection list
│   ├── SettingsPanel.tsx  # User settings UI
│   ├── StatsBar.tsx       # Live CPU and memory stats via UserStore subscription
│   └── ToastContainer.tsx # Toast notification display
├── renderer/
│   ├── RoomRenderer.ts          # PixiJS Application: draggable/zoomable world container, navigation zones
│   ├── MapRenderer.ts           # World map renderer
│   ├── TerrainLayer.ts          # Plain/Wall/Swamp tiles
│   ├── ObjectLayer.ts           # Creeps, structures; smooth movement via ticker
│   ├── VisualLayer.ts           # Screeps visual primitives
│   ├── ActionAnimationLayer.ts  # Attack/heal/rangedAttack animations
│   ├── HoverHighlightLayer.ts   # Hover highlight overlay
│   ├── BadgeTextureCache.ts     # Player badge texture cache
│   ├── StructureTextureCache.ts # Structure texture cache
│   ├── terrainCache.ts          # Terrain tile texture cache
│   ├── terrain.worker.ts        # Terrain decode web worker
│   └── colors.ts                # Shared color constants
├── stores/
│   ├── clientStore.ts      # SolidJS signals (client, status, error) + connect/disconnect/tryAutoConnect
│   ├── roomViewStore.tsx   # Active room view state (room name, shard, viewport)
│   ├── roomDataStore.ts    # Room objects and terrain reactive cache
│   ├── selectionStore.ts   # Selected game object state
│   ├── settingsStore.ts    # Persisted user settings
│   ├── consoleStore.ts     # Console log history
│   ├── mapOverlayStore.ts  # World map overlay mode
│   └── toastStore.ts       # Toast notification queue
├── types/
│   └── client.ts           # ClientState, RoomViewState type definitions
└── utils/
    ├── roomName.ts          # Parse/format room names (e.g. W7N7 ↔ {x, y} coordinates)
    ├── dom.ts               # DOM helpers
    ├── embedded.ts          # Embedded/mod mode detection
    ├── log.ts               # Logger instance
    ├── storage.ts           # localStorage key constants and helpers
    └── useRoomNavigationKeys.ts  # Keyboard shortcut hook for room navigation
```

**State management**: `clientStore.ts` holds SolidJS signals (`client`, `status`, `error`) and functions (`connect`, `disconnect`, `tryAutoConnect`). Credentials are persisted to `localStorage` for auto-reconnect on page reload. `App.tsx` calls `tryAutoConnect()` on mount.

**`RoomViewer.tsx`** subscribes to `RoomStore` and `UserStore`, creates `TerrainLayer` and `ObjectLayer`, and hands them to `RoomRenderer`.

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

- Run all tests: `pnpm test` (from `screeps-connectivity/`)
- Run one file: `npx vitest run tests/socket/SocketClient.test.ts`
- Test environment: Node (Vitest); uses `fake-indexeddb` for storage tests

## Pull Requests

- Branch off `main`. Keep PRs focused — one logical change per PR.
- Before opening a PR, run the checks the user-facing change touches: `pnpm lint` for any package you edited, and `pnpm test` (from `screeps-connectivity/`) if you touched the library.
- **If your change affects a published package, add a changeset in the same PR** (see "Releases" below). PRs that change public package behaviour without a changeset will land unversioned and never publish.
- Use `gh pr create` and keep the title short (under 70 chars). Put detail in the body.

## Releases

Versioning and npm publishing are handled by [Changesets](https://github.com/changesets/changesets) via `.github/workflows/release.yml`. Do **not** hand-edit `version` fields in any `package.json` — changesets owns them.

### Adding a changeset

When a change affects one or more published packages, run from the repo root:

```sh
pnpm changeset
```

The CLI asks which packages changed and at what semver level (patch / minor / major). It writes a markdown file to `.changeset/` — commit it with the rest of the change.

Rules of thumb for picking the bump:
- **patch** — bug fixes, internal refactors, doc-only changes that affect the published README
- **minor** — new public API surface, additive features that keep existing API working
- **major** — breaking changes to the public API of `screeps-connectivity`, or to the published shape of any other package

Internal `workspace:*` consumers get a patch bump automatically when an upstream package version changes (`updateInternalDependencies: "patch"` in `.changeset/config.json`).

If a change does not need a release (refactors confined to `screeps-client` internals, CI tweaks, etc.), either skip the changeset entirely or use `pnpm changeset --empty` if you want to record the intent.

### Release flow

On push to `main`:

1. If unreleased changesets exist, the workflow opens (or updates) a **"chore: version packages"** PR that bumps `package.json` versions and updates each package's `CHANGELOG.md`. Review and merge that PR to trigger a publish.
2. If no changesets are pending, the workflow builds all four packages and runs `changeset publish`, which only pushes versions that aren't already on npm.

The publish step depends on the `NPM_TOKEN` secret. Do not invoke `pnpm publish` manually — let CI do it.

### Useful release commands

```sh
pnpm changeset            # add a changeset (interactive)
pnpm changeset --empty    # record an intentionally version-less change
pnpm exec changeset status  # show pending changesets and projected bumps
pnpm build:release        # locally reproduce the CI build pipeline
```

Do not run `pnpm version-packages` or `pnpm release` locally — these are wired for CI use only.
