import { createSignal } from 'solid-js'
import { basePath } from '~/utils/embedded.js'

// Top-level screen the connected app shows. The in-game Dashboard owns its own
// /room and /map sub-routing; this store decides Overview (self) vs. Profile
// (public, any user) vs. the game view.
export type Route = 'overview' | 'profile' | 'game'

function overviewPath(): string {
  return `${basePath()}/overview`
}

function profilePrefix(): string {
  return `${basePath()}/profile/`
}

function currentPath(): string {
  return window.location.pathname + window.location.search + window.location.hash
}

function parseRoute(): Route {
  const p = window.location.pathname
  if (p === overviewPath()) return 'overview'
  if (p.startsWith(profilePrefix())) return 'profile'
  return 'game'
}

function parseProfileUsername(): string | null {
  const p = window.location.pathname
  if (!p.startsWith(profilePrefix())) return null
  const name = decodeURIComponent(p.slice(profilePrefix().length))
  return name || null
}

const [route, setRoute] = createSignal<Route>(parseRoute())
const [profileUsername, setProfileUsername] = createSignal<string | null>(parseProfileUsername())
export { route, profileUsername }

// Remembered so returning to the world restores the exact game view (room +
// shard + history tick) rather than dropping back to the default map.
let lastGamePath = parseRoute() === 'game' ? currentPath() : `${basePath()}/map`

function rememberGamePath(): void {
  if (parseRoute() === 'game') lastGamePath = currentPath()
}

export function goToOverview(): void {
  rememberGamePath()
  history.pushState(null, '', overviewPath())
  setRoute('overview')
}

export function goToProfile(username: string): void {
  rememberGamePath()
  history.pushState(null, '', `${profilePrefix()}${encodeURIComponent(username)}`)
  setProfileUsername(username)
  setRoute('profile')
}

export function goToGame(): void {
  history.pushState(null, '', lastGamePath)
  setRoute('game')
}

// Jump straight to a specific room view (the Dashboard mounts on route→'game'
// and reads room + shard from the URL).
export function goToRoom(room: string, shard: string | null): void {
  const path = `${basePath()}/room/${room}${shard ? `?shard=${encodeURIComponent(shard)}` : ''}`
  lastGamePath = path
  history.pushState(null, '', path)
  setRoute('game')
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    setRoute(parseRoute())
    setProfileUsername(parseProfileUsername())
  })
}
