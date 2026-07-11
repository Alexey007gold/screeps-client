import { Container, type Renderer, type Ticker } from 'pixi.js'
import type { Badge, RoomObjectMap, RoomObjectDiff, RoomTerrain } from 'screeps-connectivity'
import { createTerrainLayer } from './TerrainLayer.js'
import { ObjectLayer } from './ObjectLayer.js'
import { HoverHighlightLayer, type SelectionVisual } from './HoverHighlightLayer.js'
import { ActionAnimationLayer } from './ActionAnimationLayer.js'
import { applyActionLogAnimations } from './actionLogAnimations.js'
import { Z } from './RoomRenderer.js'
import { sharedAtlasCache } from './AtlasCache.js'
import { defaultSpriteTheme } from './themes/default.js'

export interface RoomSceneUpdateOptions {
  showLabels: boolean
  currentUserId?: string | null
  currentUserBadge?: Badge | null
  users?: Record<string, { _id: string; username: string; badge?: Badge }>
  gameTime?: number
  moveDuration: number
  tickDuration: number
}

// One full-detail room inside the multi-room grid: terrain + all game objects,
// clickable and hoverable exactly like the single-room view. Positioned by the
// caller at (rx*ROOM_WORLD_SIZE, ry*ROOM_WORLD_SIZE) via `root.x/root.y`.
// ObjectLayer/TerrainLayer/HoverHighlightLayer are room-agnostic (they draw in
// 0..600 tile-local coordinates), so this is mostly wiring + lifecycle.
export class RoomScene {
  readonly root: Container
  readonly hoverLayer: HoverHighlightLayer

  private readonly ticker: Ticker
  private terrainLayer: Container | null = null
  private objLayer: ObjectLayer | null = null
  private animLayer: ActionAnimationLayer | null = null
  private terrainReady = false

  constructor(ticker: Ticker) {
    this.ticker = ticker
    this.root = new Container({ sortableChildren: true })

    this.hoverLayer = new HoverHighlightLayer(ticker)
    this.hoverLayer.container.zIndex = Z.hover
    this.root.addChild(this.hoverLayer.container)
  }

  // Terrain baked (vector) exactly like the single-room view — reusing
  // createTerrainLayer means full-detail rooms are pixel-identical to RoomViewer.
  applyTerrain(terrain: RoomTerrain, rendererGpu: Renderer): void {
    if (this.terrainLayer) return // already applied; RoomScene is one-shot per mount
    this.terrainLayer = createTerrainLayer(terrain, rendererGpu)
    this.terrainLayer.zIndex = Z.terrain
    this.root.addChildAt(this.terrainLayer, 0)
    this.terrainReady = true
  }

  // `diff` should always be the latest tick's diff (or undefined for a full
  // snapshot) — RoomScene decides internally whether to treat it as a full
  // reconcile. The room subscription in the component starts before this
  // scene may even exist yet, so the very first call here — regardless of
  // whether the caller has a diff — must NOT partially-apply: the ObjectLayer
  // doesn't exist yet, so its own creation forces a full build from `objects`.
  applyUpdate(objects: RoomObjectMap, diff: RoomObjectDiff | undefined, opts: RoomSceneUpdateOptions): void {
    const isFirstUpdate = !this.objLayer
    const effectiveDiff = isFirstUpdate ? undefined : diff

    if (!this.objLayer) {
      this.objLayer = new ObjectLayer(this.ticker, opts.showLabels, opts.currentUserId ?? undefined, opts.currentUserBadge ?? undefined, opts.users)
      this.objLayer.setTheme(defaultSpriteTheme, sharedAtlasCache)
      this.objLayer.container.label = 'objects'
      this.objLayer.container.zIndex = Z.objects
      this.root.addChild(this.objLayer.container)

      this.animLayer = new ActionAnimationLayer(this.ticker)
      this.animLayer.container.label = 'animations'
      this.animLayer.container.zIndex = Z.animations
      this.root.addChild(this.animLayer.container)
    }

    this.objLayer.setMoveDuration(opts.moveDuration)
    this.objLayer.setTickDuration(opts.tickDuration)
    this.objLayer.update(objects, effectiveDiff, opts.users, opts.gameTime)
    this.objLayer.setShowLabels(opts.showLabels)

    // Mirrors RoomViewer's actionLog → beam pipeline so grid rooms show the same
    // harvest/upgrade/build/etc. action lines as the single-room view.
    if (this.animLayer) {
      const beamDuration = opts.tickDuration * 0.6
      applyActionLogAnimations(objects, this.animLayer, this.objLayer, beamDuration, opts.currentUserId)
    }
  }

  // Ready once terrain is baked AND the first full object reconcile has
  // landed — mirrors MapRenderer.revealIfReady's stats-before-terrain gate,
  // here gating the map2→full-detail swap so nothing blank ever shows.
  isReady(): boolean {
    return this.terrainReady && this.objLayer !== null
  }

  // True once the first full object snapshot has landed, regardless of terrain
  // readiness — see MultiRoomRenderer.hasFullDetailObjects for why this is
  // tracked separately from isReady().
  hasObjectLayer(): boolean {
    return this.objLayer !== null
  }

  getObjectsAtTile(tx: number, ty: number): { id: string; obj: import('screeps-connectivity').RoomObject }[] {
    return this.objLayer?.getObjectsAtTile(tx, ty) ?? []
  }

  getVisualById(id: string): Container | undefined {
    return this.objLayer?.getVisualById(id)
  }

  setSelectedObjects(objects: SelectionVisual[]): void {
    this.hoverLayer.setSelectedObjects(objects)
  }

  setHoveredTile(tx: number | null, ty: number | null): void {
    this.hoverLayer.setHoveredTile(tx, ty)
  }

  dispose(): void {
    if (this.animLayer) {
      this.root.removeChild(this.animLayer.container)
      this.animLayer.destroy()
      this.animLayer = null
    }
    if (this.objLayer) {
      this.objLayer.destroy()
      this.root.removeChild(this.objLayer.container)
      this.objLayer.container.destroy({ children: true, context: true })
      this.objLayer = null
    }
    if (this.terrainLayer) {
      this.root.removeChild(this.terrainLayer)
      this.terrainLayer.destroy({ children: true })
      this.terrainLayer = null
    }
    this.root.removeChild(this.hoverLayer.container)
    this.hoverLayer.destroy()
    this.root.removeFromParent()
    this.root.destroy({ children: false })
  }
}
