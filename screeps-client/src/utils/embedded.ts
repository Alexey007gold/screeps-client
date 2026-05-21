const BUILD_FLAG = import.meta.env.VITE_EMBEDDED === 'true'
const XXSCREEPS_FLAG = import.meta.env.VITE_XXSCREEPS === 'true'

export function isEmbedded(): boolean {
  if (BUILD_FLAG) return true
  if (typeof window === 'undefined') return false
  return window.location.pathname.startsWith('/client')
}

export function isXxscreepsMode(): boolean {
  return XXSCREEPS_FLAG
}

export function embeddedServerUrl(): string {
  return window.location.origin
}

// Returns the path prefix where the app is mounted, without trailing slash.
// e.g. '/client' when mounted as a server mod, '' for standalone.
export function basePath(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, '')
}
