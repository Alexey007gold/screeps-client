import { Assets, type Texture } from 'pixi.js'
import { decorationTextureUrl } from './decorationTextureUrl.js'
import { isTauri } from '~/utils/tauri.js'

const pending = new Map<string, Promise<Texture>>()
const resolvedUrls = new Map<string, Promise<string>>()

/**
 * WKWebView enforces CORS on `tauri://localhost` like any other origin, and S3
 * doesn't grant it access, so decoration textures have to be pulled through the
 * HTTP plugin (a native Rust request, not subject to WebView CORS) and consumed
 * via a same-origin blob: URL instead of the raw https:// one. Blob URLs created
 * here are also fetchable from same-origin dedicated workers, which is how the
 * terrain bake worker gets its copies. The relative dev-proxy path is left alone:
 * it is CORS-free already, and reqwest cannot resolve a relative URL anyway.
 */
export function resolveDecorationAssetUrl(url: string): Promise<string> {
  const src = decorationTextureUrl(url)
  if (!isTauri() || !src.startsWith('https://')) return Promise.resolve(src)
  let promise = resolvedUrls.get(src)
  if (!promise) {
    promise = (async () => {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
      const res = await tauriFetch(src)
      if (!res.ok) throw new Error(String(res.status))
      return URL.createObjectURL(await res.blob())
    })().catch((err) => {
      resolvedUrls.delete(src)
      throw err
    })
    resolvedUrls.set(src, promise)
  }
  return promise
}

/**
 * Load a decoration texture by its API URL, deduplicated across layers and room
 * switches. Failures are dropped from the cache so a later visit retries instead
 * of replaying a rejected promise forever.
 */
export function loadDecorationTexture(url: string): Promise<Texture> {
  const src = decorationTextureUrl(url)
  let promise = pending.get(src)
  if (!promise) {
    const parser = src.toLowerCase().endsWith('.svg') ? 'svg' : 'texture'
    promise = resolveDecorationAssetUrl(url)
      .then((resolved) => Assets.load<Texture>({ src: resolved, parser }))
      .catch((err) => {
        pending.delete(src)
        throw err
      })
    pending.set(src, promise)
  }
  return promise
}
