const CACHE_NAME = 'screeps-terrain-v1'

export async function getTerrainCacheBlob(shard: string, roomName: string, lod: number): Promise<Blob | null> {
  try {
    const cache = await caches.open(CACHE_NAME)
    const key = `/terrain/${shard}_${roomName}_z${lod}.webp`
    const req = new Request(key)
    const res = await cache.match(req)
    if (res) {
      return await res.blob()
    }
  } catch (err) {
    console.warn('[terrainCache] get failed:', err)
  }
  return null
}

export async function saveTerrainCacheBlob(shard: string, roomName: string, lod: number, blob: Blob): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME)
    const key = `/terrain/${shard}_${roomName}_z${lod}.webp`
    const req = new Request(key)
    const res = new Response(blob)
    await cache.put(req, res)
  } catch (err) {
    console.warn('[terrainCache] save failed:', err)
  }
}

export async function imageBitmapToBlob(bitmap: ImageBitmap): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2D context not available')
  ctx.drawImage(bitmap, 0, 0)
  return await canvas.convertToBlob({ type: 'image/webp' })
}

export async function blobToImageBitmap(blob: Blob): Promise<ImageBitmap> {
  return await createImageBitmap(blob)
}
