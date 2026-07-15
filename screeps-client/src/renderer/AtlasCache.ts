import { Assets, type Spritesheet, type Texture } from 'pixi.js'

export class AtlasCache {
  private readonly cache = new Map<string, Spritesheet>()
  private readonly pending = new Map<string, Promise<Spritesheet>>()
  // Flattened frame→texture lookup per atlas, combining the spritesheet with any
  // MultiPack-linked sheets (TexturePacker `related_multi_packs`). PixiJS keeps
  // linked-sheet frames in `sheet.linkedSheets[i].textures`, not the parent's
  // `.textures`, so we merge them here to keep lookups O(1) and pack-agnostic.
  private readonly frames = new Map<string, Record<string, Texture>>()

  getOrLoad(atlasUrl: string): Promise<Spritesheet> {
    const url = resolveUrl(atlasUrl)
    const cached = this.cache.get(url)
    if (cached) return Promise.resolve(cached)
    const inFlight = this.pending.get(url)
    if (inFlight) return inFlight
    const p = Assets.load<Spritesheet>(url).then(sheet => {
      this.cache.set(url, sheet)
      this.frames.set(url, mergeFrames(sheet))
      this.pending.delete(url)
      return sheet
    }).catch(err => {
      this.pending.delete(url)
      throw err
    })
    this.pending.set(url, p)
    return p
  }

  getTexture(atlasUrl: string, frame: string): Texture | undefined {
    return this.frames.get(resolveUrl(atlasUrl))?.[frame]
  }

  destroy(): void {
    for (const [, sheet] of this.cache) {
      for (const linked of sheet.linkedSheets ?? []) linked.destroy(true)
      sheet.destroy(true)
    }
    this.cache.clear()
    this.frames.clear()
    this.pending.clear()
  }
}

// PixiJS's own path resolver (pixi.js/utils/path.js `isUrl`) only recognizes
// http(s) origins, so under Tauri's macOS webview (origin `tauri://localhost`)
// it drops the host when resolving a root-relative atlas URL, sending requests
// to e.g. `tauri://themes/...` instead of `tauri://localhost/themes/...`.
// Resolving via the native URL API first hands Pixi an already-absolute URL,
// which it recognizes as-is and never tries to re-resolve.
function resolveUrl(url: string): string {
  return new URL(url, document.baseURI).href
}

function mergeFrames(sheet: Spritesheet): Record<string, Texture> {
  const merged: Record<string, Texture> = { ...sheet.textures }
  for (const linked of sheet.linkedSheets ?? []) Object.assign(merged, linked.textures)
  return merged
}

export const sharedAtlasCache = new AtlasCache()
