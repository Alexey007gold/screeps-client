# screeps-client-proxy

A small standalone proxy that serves the **new** [`screeps-client`](../screeps-client)
web build locally and forwards its `/api` + `/socket` traffic (including the game
WebSocket) to a Screeps server.

It exists because the browser build can only talk to servers on its own origin —
cross-origin requests to `screeps.com` or a private server are blocked by CORS.
The Tauri desktop app solves this with a native HTTP plugin; this proxy solves it
for a plain browser, the same way the
[`screeps-steamless-client`](https://github.com/laverdet/screeps-steamless-client)
does for the official client.

The client is served at the origin root, and the target backend is embedded in
the request path:

```
http://localhost:8080/(https://screeps.com)/api/...
http://localhost:8080/(http://localhost:21025)/api/...
```

A single running instance can therefore serve any number of servers. You don't
build these URLs by hand — open `http://localhost:8080/`, and the client shows
the desktop-style **server-list login**. Picking or adding a server makes the
connectivity layer prepend the `/(backend)/` prefix automatically.

## Usage

Build the client once, then start the proxy:

```sh
# from the monorepo root
pnpm --filter screeps-client build
pnpm --filter screeps-client-proxy start
# → http://localhost:8080/
```

Or, once published:

```sh
npx screeps-client-proxy
```

## Options

| Flag | Description |
|---|---|
| `--port <int>` | Port to listen on (default `8080`) |
| `--host <str>` | Host/interface to bind (default `localhost`) |
| `--backend <url>` | Pin a single backend, dropping the `/(backend)/` requirement. Requests go straight to this server and the login targets it directly. |
| `--internal_backend <url>` | Actual proxy target when it differs from the browser-facing backend URL (e.g. behind Docker / a reverse proxy). |
| `--dist <path>` | Path to the client's standalone build. Defaults to the `dist/standalone` of the installed `screeps-client` package. |

## Caching

Assets are served with correct cache semantics so the client isn't re-downloaded
on every visit and never served stale after an update:

- Content-hashed assets under `_client/` → `Cache-Control: public, max-age=31536000, immutable`.
- Stable-URL assets (`index.html`, `themes/`, sprite atlas, …) → `Cache-Control: no-cache`
  with `ETag`/`Last-Modified`, so the browser revalidates and gets a `304` when unchanged.

## Login persistence & security

In proxy mode the client persists your server list, token and (optionally) saved
credentials in the browser's `localStorage` for the proxy's origin, so logins
survive a restart — like the desktop app. Unlike the desktop app there is no OS
keychain, so a saved token is stored in plaintext in that `localStorage`. Only
run the proxy on a machine you trust, and prefer a per-account API token you can
revoke over your account password.
