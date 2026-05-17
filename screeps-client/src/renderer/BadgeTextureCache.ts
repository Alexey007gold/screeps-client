import { Texture } from 'pixi.js'
import { badgeToSvg, type Badge } from 'screeps-connectivity'

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

export class BadgeTextureCache {
  private readonly cache = new Map<string, Texture>()
  private readonly pending = new Map<string, Promise<Texture>>()

  private getKey(badge: Badge): string {
    // Deterministic, cheap key for change detection and caching.
    // For the built-in path objects the keys are created in a fixed order.
    return JSON.stringify(badge)
  }

  has(badge: Badge): boolean {
    return this.cache.has(this.getKey(badge))
  }

  /**
   * Return a cached texture or create one asynchronously.
   * Multiple concurrent requests for the same badge share one promise.
   */
  getOrCreate(badge: Badge): Promise<Texture> {
    const key = this.getKey(badge)
    const cached = this.cache.get(key)
    if (cached) return Promise.resolve(cached)

    const existing = this.pending.get(key)
    if (existing) return existing

    const promise = this.buildTexture(badge, key)
    this.pending.set(key, promise)

    promise.then(() => {
      this.pending.delete(key)
    }).catch(() => {
      this.pending.delete(key)
    })

    return promise
  }

  private async buildTexture(badge: Badge, key: string): Promise<Texture> {
    const svg = badgeToSvg(badge)
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    try {
      const img = await loadImage(url)
      const texture = Texture.from(img)
      this.cache.set(key, texture)
      return texture
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  destroy(): void {
    for (const tex of this.cache.values()) {
      if (!tex.destroyed) tex.destroy(true)
    }
    this.cache.clear()
    this.pending.clear()
  }
}
