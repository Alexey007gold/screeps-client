import { isTauri } from '~/utils/tauri.js'
import { isProxy } from '~/utils/proxy.js'
import { isEmbedded, isXxscreepsMode } from '~/utils/embedded.js'
import { isPrivateServer, serverVersion } from './clientStore.js'

export interface Capabilities {
  isDesktop: boolean
  // Served by screeps-client-proxy (browser, /api+/socket proxied via /(backend)/).
  isProxy: boolean
  isEmbedded: boolean
  isXxscreepsMode: boolean
  isPrivateServer: boolean | null
  // Room history playback. Gated on the server advertising a history chunk
  // size in /api/version — servers that don't store tick history omit it.
  hasHistory: boolean
  // Placeholders: no server-side signal exists yet for these. Flip to real
  // detection here (a feature flag, a probe, whatever) without touching callers.
  hasMarket: boolean
  hasMessaging: boolean
}

export function capabilities(): Capabilities {
  return {
    isDesktop: isTauri(),
    isProxy: isProxy(),
    isEmbedded: isEmbedded(),
    isXxscreepsMode: isXxscreepsMode(),
    isPrivateServer: isPrivateServer(),
    hasHistory: (serverVersion()?.serverData?.historyChunkSize ?? 0) > 0,
    hasMarket: true,
    hasMessaging: true,
  }
}
