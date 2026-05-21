import type { ServerVersion } from '../types/game.js'
import type { ScreepsmodAuthFeature, ServerFeature } from '../types/game.js'

const SESSION_CACHE_TTL_MS = 5 * 60_000

interface CachedEntry {
  data: ServerVersion
  expires: number
}

function sessionKey(url: string): string {
  try {
    return `screeps:version:${new URL(url).hostname}`
  } catch {
    return `screeps:version:${url}`
  }
}

function readFromSession(url: string): ServerVersion | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(sessionKey(url))
    if (!raw) return null
    const entry = JSON.parse(raw) as CachedEntry
    if (Date.now() > entry.expires) {
      sessionStorage.removeItem(sessionKey(url))
      return null
    }
    return entry.data
  } catch {
    return null
  }
}

function writeToSession(url: string, data: ServerVersion): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    const entry: CachedEntry = { data, expires: Date.now() + SESSION_CACHE_TTL_MS }
    sessionStorage.setItem(sessionKey(url), JSON.stringify(entry))
  } catch { /* quota exceeded or SSR — ignore */ }
}

/**
 * Fetch `/api/version` from a Screeps server without authentication.
 * The result is cached in `sessionStorage` for 5 minutes (per server hostname).
 * Useful for pre-login UI: showing the welcome text and detecting installed mods.
 */
export async function fetchServerVersion(url: string): Promise<ServerVersion> {
  const cached = readFromSession(url)
  if (cached) return cached

  const base = url.endsWith('/') ? url : `${url}/`
  const res = await fetch(`${base}api/version`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json() as ServerVersion
  writeToSession(url, data)
  return data
}

/**
 * Extract a specific feature entry from a `ServerVersion` response by name.
 * Returns `undefined` if the feature is not present.
 *
 * @example
 * const authMod = getServerFeature<ScreepsmodAuthFeature>(version, 'screepsmod-auth')
 * if (authMod) console.log('Auth types:', authMod.authTypes)
 */
export function getServerFeature<T extends ServerFeature = ServerFeature>(
  version: ServerVersion,
  name: string,
): T | undefined {
  return version.serverData.features.find(f => f.name === name) as T | undefined
}

/**
 * Returns the `screepsmod-auth` feature entry if present, otherwise `undefined`.
 * Use this to check whether the server supports password login, registration,
 * Steam auth, etc., before showing those UI options.
 *
 * @example
 * const auth = getScreepsmodAuth(version)
 * if (auth?.authTypes.includes('password')) showPasswordForm()
 */
export function getScreepsmodAuth(version: ServerVersion): ScreepsmodAuthFeature | undefined {
  return getServerFeature<ScreepsmodAuthFeature>(version, 'screepsmod-auth')
}
