import { Container, Sprite, Texture } from 'pixi.js'
import { formatRoomName } from '~/utils/roomName.js'
import { getTerrainCacheBlob, blobToImageBitmap } from './terrainCache.js'
import { SECTOR_ROOMS, sectorOf, sectorRooms } from './sectorTerrain.js'
import { createLogger } from '~/utils/log.js'

const { warn } = createLogger('SectorTerrainLayer')

export interface RoomBounds {
  rxMin: number
  rxMax: number
  ryMin: number
  ryMax: number
}

export interface WorldRoomBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface SectorTerrainSource {
  roomSize: number
  isRoomFetched(roomName: string): boolean
  roomTerrain(roomName: string): Uint8Array | null
  worldBounds(): WorldRoomBounds | null
  cacheScope(): string
  bake(raws: (Uint8Array | null)[], scope: string, cacheName: string): Promise<ImageBitmap | null>
}

interface SectorEntry {
  sx: number
  sy: number
  state: 'loading' | 'waiting' | 'baking' | 'ready'
  sprite: Sprite | null
}

function sectorCacheName(sx: number, sy: number): string {
  return `sector-v1_${sx}_${sy}`
}

export function expandToSectors(b: RoomBounds): RoomBounds {
  return {
    rxMin: sectorOf(b.rxMin) * SECTOR_ROOMS,
    ryMin: sectorOf(b.ryMin) * SECTOR_ROOMS,
    rxMax: sectorOf(b.rxMax) * SECTOR_ROOMS + SECTOR_ROOMS - 1,
    ryMax: sectorOf(b.ryMax) * SECTOR_ROOMS + SECTOR_ROOMS - 1,
  }
}

export class SectorTerrainLayer {
  readonly container = new Container()
  private readonly sectors = new Map<string, SectorEntry>()
  private readonly source: SectorTerrainSource
  private gen = 0

  constructor(source: SectorTerrainSource) {
    this.source = source
    this.container.visible = false
  }

  update(b: RoomBounds): void {
    for (let sy = sectorOf(b.ryMin); sy <= sectorOf(b.ryMax); sy++) {
      for (let sx = sectorOf(b.rxMin); sx <= sectorOf(b.rxMax); sx++) {
        if (!this.inWorld(sx, sy)) continue
        const key = `${sx},${sy}`
        const sector = this.sectors.get(key)
        if (!sector) void this.load(key, sx, sy)
        else if (sector.state === 'waiting' && this.roomsReady(sx, sy)) this.bake(key, sector)
      }
    }
  }

  evictOutside(b: RoomBounds, padding: number): void {
    for (const [key, sector] of [...this.sectors]) {
      const x0 = sector.sx * SECTOR_ROOMS, y0 = sector.sy * SECTOR_ROOMS
      if (x0 + SECTOR_ROOMS - 1 < b.rxMin - padding || x0 > b.rxMax + padding ||
          y0 + SECTOR_ROOMS - 1 < b.ryMin - padding || y0 > b.ryMax + padding) {
        this.remove(key)
      }
    }
  }

  clear(): void {
    this.gen++
    for (const key of [...this.sectors.keys()]) this.remove(key)
  }

  private inWorld(sx: number, sy: number): boolean {
    const b = this.source.worldBounds()
    if (!b) return true
    const x0 = sx * SECTOR_ROOMS, y0 = sy * SECTOR_ROOMS
    return x0 + SECTOR_ROOMS - 1 >= b.minX && x0 <= b.maxX && y0 + SECTOR_ROOMS - 1 >= b.minY && y0 <= b.maxY
  }

  private roomsReady(sx: number, sy: number): boolean {
    const b = this.source.worldBounds()
    for (const { rx, ry } of sectorRooms(sx, sy)) {
      if (b && (rx < b.minX || rx > b.maxX || ry < b.minY || ry > b.maxY)) continue
      const name = formatRoomName(rx, ry)
      if (name && !this.source.isRoomFetched(name)) return false
    }
    return true
  }

  private async load(key: string, sx: number, sy: number): Promise<void> {
    const sector: SectorEntry = { sx, sy, state: 'loading', sprite: null }
    this.sectors.set(key, sector)
    const gen = this.gen
    const blob = await getTerrainCacheBlob(this.source.cacheScope(), sectorCacheName(sx, sy), 0)
    if (gen !== this.gen || this.sectors.get(key) !== sector) return
    if (blob) {
      try {
        this.place(key, sector, await blobToImageBitmap(blob), gen)
        return
      } catch (err) {
        warn('cached sector decode failed:', key, err)
      }
    }
    sector.state = 'waiting'
    if (this.roomsReady(sx, sy)) this.bake(key, sector)
  }

  private bake(key: string, sector: SectorEntry): void {
    sector.state = 'baking'
    const raws = sectorRooms(sector.sx, sector.sy).map(({ rx, ry }) => {
      const name = formatRoomName(rx, ry)
      return name ? this.source.roomTerrain(name) : null
    })
    const gen = this.gen
    this.source.bake(raws, this.source.cacheScope(), sectorCacheName(sector.sx, sector.sy))
      .then((bitmap) => this.place(key, sector, bitmap, gen))
      .catch((err) => {
        warn('sector bake failed:', key, err)
        if (this.sectors.get(key) === sector) this.sectors.delete(key)
      })
  }

  private place(key: string, sector: SectorEntry, bitmap: ImageBitmap | null, gen: number): void {
    if (gen !== this.gen || this.sectors.get(key) !== sector) {
      bitmap?.close()
      return
    }
    if (!bitmap) {
      this.sectors.delete(key)
      return
    }
    const size = SECTOR_ROOMS * this.source.roomSize
    const sprite = new Sprite(Texture.from(bitmap, true))
    sprite.x = sector.sx * size
    sprite.y = sector.sy * size
    sprite.width = size
    sprite.height = size
    this.container.addChild(sprite)
    sector.sprite = sprite
    sector.state = 'ready'
  }

  private remove(key: string): void {
    const sector = this.sectors.get(key)
    if (!sector) return
    this.sectors.delete(key)
    if (sector.sprite) {
      this.container.removeChild(sector.sprite)
      sector.sprite.texture.destroy(true)
      sector.sprite.destroy()
    }
  }
}
