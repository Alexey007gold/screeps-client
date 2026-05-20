const BUILD_FLAG = import.meta.env.VITE_EMBEDDED === 'true'

export function isEmbedded(): boolean {
  if (BUILD_FLAG) return true
  if (typeof window === 'undefined') return false
  return window.location.pathname.startsWith('/client')
}

export function embeddedServerUrl(): string {
  return window.location.origin
}
