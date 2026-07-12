// Integrated-proxy mode. When the client is served by `screeps-client-proxy`
// (a local server that forwards /api + /socket to any Screeps backend), the
// proxy injects `window.__SCREEPS_CLIENT_PROXY__` into index.html. In that mode
// the target backend is embedded in the request path — `/(https://server)/api/…`
// — so cross-origin requests go through the proxy and dodge browser CORS.
//
// The connectivity layer needs no changes for this: HttpClient resolves paths
// relative to a trailing-slash baseUrl and SocketClient derives the WS URL from
// the same `url`, so setting the client `url` to the wrapped form is enough.

export interface ProxyModeInfo {
  kind: 'screeps-proxy'
  packageName: string
  version: string
  /** Set only when the proxy was started with a pinned `--backend`. */
  backend?: string
}

declare global {
  interface Window {
    __SCREEPS_CLIENT_PROXY__?: ProxyModeInfo
  }
}

/** True when the client is served by screeps-client-proxy. */
export function isProxy(): boolean {
  return typeof window !== 'undefined' && window.__SCREEPS_CLIENT_PROXY__ != null
}

/** The pinned backend, if the proxy was started with `--backend`; otherwise null. */
export function proxyPinnedBackend(): string | null {
  return window.__SCREEPS_CLIENT_PROXY__?.backend ?? null
}

/**
 * Wrap a Screeps server URL into the proxy path form
 * `${origin}/(${serverUrl})`, so requests route through the proxy to that
 * backend. Idempotent — a URL that is already wrapped for this origin is
 * returned unchanged, so it is safe to call on persisted (already-wrapped) URLs
 * during auto-connect.
 */
export function toProxyUrl(url: string): string {
  const origin = window.location.origin
  // A pinned proxy forwards bare `/api` + `/socket` straight to its single
  // backend, so the client talks to the origin directly with no path-wrapping.
  if (proxyPinnedBackend()) return origin
  if (url.startsWith(`${origin}/(`)) return url
  return `${origin}/(${url.replace(/\/$/, '')})`
}
