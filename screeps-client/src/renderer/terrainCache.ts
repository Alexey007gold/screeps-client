import { createLogger } from '~/utils/log.js'
import { SS, getSession } from '~/utils/storage.js'
import { isLocalServerUrl } from '~/utils/localServer.js'

const { warn } = createLogger('terrainCache')

const CACHE_NAME = 'screeps-terrain-v2'
const LEGACY_CACHE_NAMES = ['screeps-terrain-v1']

let legacyCleanup: Promise<void> | null = null

function openTerrainCache(): Promise<Cache> {
  legacyCleanup ??= Promise.all(LEGACY_CACHE_NAMES.map((name) => caches.delete(name)))
    .then(() => undefined, () => undefined)
  return caches.open(CACHE_NAME)
}

export function terrainCacheScope(shard: string): string {
  return `${getSession(SS.url) ?? ''}|${shard}`
}

function scopeIsLocalServer(scope: string): boolean {
  return isLocalServerUrl(scope.slice(0, scope.lastIndexOf('|')))
}

export function terrainCacheKey(scope: string, roomName: string, lod: number): string {
  return `/terrain/${encodeURIComponent(scope)}/${roomName}_z${lod}.webp`
}

export async function getTerrainCacheBlob(scope: string, roomName: string, lod: number): Promise<Blob | null> {
  if (scopeIsLocalServer(scope)) return null
  try {
    const cache = await openTerrainCache()
    const req = new Request(terrainCacheKey(scope, roomName, lod))
    const res = await cache.match(req)
    if (res) {
      // WebKit taints blobs handed out by Response.blob() from the Cache API: the
      // blob: URL they generate is treated as cross-origin, so both
      // createImageBitmap(blob) and <img>.src fail with an "access control
      // checks" error. Copying the bytes into a fresh, page-origin Blob strips
      // the taint, so decoding works in every browser.
      const buf = await res.arrayBuffer()
      const type = res.headers.get('Content-Type') ?? 'image/webp'
      return new Blob([buf], { type })
    }
  } catch (err) {
    warn('get failed:', err)
  }
  return null
}

export async function saveTerrainCacheBlob(scope: string, roomName: string, lod: number, blob: Blob): Promise<void> {
  if (scopeIsLocalServer(scope)) return
  try {
    const cache = await openTerrainCache()
    const req = new Request(terrainCacheKey(scope, roomName, lod))
    const res = new Response(blob)
    await cache.put(req, res)
  } catch (err) {
    warn('save failed:', err)
  }
}

// The WebKit "access control checks" failure for Cache-API blobs is fixed at
// the source in getTerrainCacheBlob (bytes copied into a fresh page-origin
// Blob). This fallback to HTMLImageElement decoding remains only as a safety
// net for browsers that lack createImageBitmap(Blob) support entirely; we
// detect the gap once and then stay on the fallback path. Both branches return
// an ImageBitmap so callers can still .close() the result.
let blobBitmapSupported: boolean | null = null

export async function blobToImageBitmap(blob: Blob): Promise<ImageBitmap> {
  if (blobBitmapSupported !== false) {
    try {
      const bitmap = await createImageBitmap(blob)
      blobBitmapSupported = true
      return bitmap
    } catch (err) {
      // Once we know the direct path works, a later failure is a real decode
      // error and must propagate rather than silently switching strategies.
      if (blobBitmapSupported === true) throw err
      blobBitmapSupported = false
    }
  }

  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return await createImageBitmap(img)
  } finally {
    URL.revokeObjectURL(url)
  }
}
