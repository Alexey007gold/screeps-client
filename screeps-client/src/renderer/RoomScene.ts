import { Container, type Renderer, type Ticker } from 'pixi.js'
import type { Badge, RoomObjectMap, RoomObjectDiff, RoomTerrain } from 'screeps-connectivity'
import { createTerrainLayer } from './TerrainLayer.js'
import { ObjectLayer } from './ObjectLayer.js'
import { HoverHighlightLayer, type SelectionVisual } from './HoverHighlightLayer.js'
import { ActionAnimationLayer } from './ActionAnimationLayer.js'
import { applyActionLogAnimations } from './actionLogAnimations.js'
import { LightingLayer, buildLights } from './LightingLayer.js'
import { VisualLayer } from './VisualLayer.js'
import { Z } from './RoomRenderer.js'
import { sharedAtlasCache } from './AtlasCache.js'
import { defaultSpriteTheme } from './themes/default.js'
import type { RoomDecoration } from './roomDecorations.js'

export interface RoomSceneUpdateOptions {
  showLabels: boolean
  currentUserId?: string | null
  currentUserBadge?: Badge | null
  users?: Record<string, { _id: string; username: string; badge?: Badge }>
  gameTime?: number
  moveDuration: number
  tickDuration: number
  visual?: string
  showRoomVisuals?: boolean
  darkOverlayEnabled?: boolean
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
  private readonly lighting: LightingLayer
  private readonly visualLayer: VisualLayer
  private terrainLayer: Container | null = null
  private objLayer: ObjectLayer | null = null
  private animLayer: ActionAnimationLayer | null = null
  private terrainReady = false
  private darkOverlayEnabled = false
  private rawTerrain: RoomTerrain | null = null
  private rendererGpu: Renderer | null = null
  private decoration: RoomDecoration | null = null
  // Set before the ObjectLayer exists yet (MultiRoomRenderer wires this up
  // right after creating the scene) — applied once applyUpdate creates it.
  private pendingNeighborLookup: ((creepId: string, dirX: number, dirY: number) => { x: number; y: number } | null) | null = null

  constructor(ticker: Ticker, rendererGpu: Renderer, world: Container) {
    this.ticker = ticker
    this.root = new Container({ sortableChildren: true })

    this.lighting = new LightingLayer(rendererGpu)
    this.lighting.displaySprite.label = 'darkOverlay'
    this.lighting.displaySprite.zIndex = Z.darkOverlay
    this.lighting.displaySprite.visible = false
    this.root.addChild(this.lighting.displaySprite)

    this.visualLayer = new VisualLayer(rendererGpu, world, ticker)
    this.visualLayer.container.zIndex = Z.visuals
    this.root.addChild(this.visualLayer.container)

    this.hoverLayer = new HoverHighlightLayer(ticker)
    this.hoverLayer.container.zIndex = Z.hover
    this.root.addChild(this.hoverLayer.container)
  }

  // Terrain baked (vector) exactly like the single-room view — reusing
  // createTerrainLayer means full-detail rooms are pixel-identical to RoomViewer.
  // Bakes with whatever decoration has already arrived (order vs. applyDecoration
  // isn't guaranteed — applyDecoration rebakes if it arrives after terrain).
  applyTerrain(terrain: RoomTerrain, rendererGpu: Renderer): void {
    if (this.terrainLayer) return // already applied; RoomScene is one-shot per mount
    this.rawTerrain = terrain
    this.rendererGpu = rendererGpu
    this.terrainLayer = createTerrainLayer(terrain, rendererGpu, this.decoration?.terrain)
    this.terrainLayer.zIndex = Z.terrain
    this.root.addChildAt(this.terrainLayer, 0)
    this.terrainReady = true
    // Terrain can arrive before or after the ObjectLayer exists (see
    // applyUpdate, which covers the other ordering).
    this.objLayer?.setTerrain(terrain)
  }

  // Owner-customized road/wall colors — applied to the live ObjectLayer tinting and
  // baked into a terrain rebuild, whichever of terrain/decoration arrived last.
  applyDecoration(decoration: RoomDecoration): void {
    this.decoration = decoration

    if (this.objLayer) {
      if (decoration.roadColor != null) this.objLayer.setRoadColor(decoration.roadColor)
      if (decoration.terrain?.wallFillColor != null) this.objLayer.setWallColor(decoration.terrain.wallFillColor)
    }

    if (this.rawTerrain && this.rendererGpu && this.terrainLayer) {
      this.root.removeChild(this.terrainLayer)
      this.terrainLayer.destroy({ children: true })
      this.terrainLayer = createTerrainLayer(this.rawTerrain, this.rendererGpu, decoration.terrain)
      this.terrainLayer.zIndex = Z.terrain
      this.root.addChildAt(this.terrainLayer, 0)
    }
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
      // Every full-detail room in the grid may have a neighbor rendering at the
      // same time — split creep room-crossing handoffs across the tick so the
      // two rooms don't briefly show the same creep twice (see ObjectLayer).
      this.objLayer.setSplitEdgeHandoff(true)
      this.objLayer.setTerrain(this.rawTerrain)
      if (this.pendingNeighborLookup) this.objLayer.setNeighborLookup(this.pendingNeighborLookup)
      this.objLayer.setTheme(defaultSpriteTheme, sharedAtlasCache)
      this.objLayer.container.label = 'objects'
      this.objLayer.container.zIndex = Z.objects
      this.root.addChild(this.objLayer.container)
      this.objLayer.setLightingLayer(this.lighting)

      if (this.decoration?.roadColor != null) this.objLayer.setRoadColor(this.decoration.roadColor)
      if (this.decoration?.terrain?.wallFillColor != null) this.objLayer.setWallColor(this.decoration.terrain.wallFillColor)

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

    this.visualLayer.update(opts.showRoomVisuals ? (opts.visual ?? '') : '')

    if (opts.darkOverlayEnabled !== this.darkOverlayEnabled) {
      this.darkOverlayEnabled = opts.darkOverlayEnabled ?? false
      this.lighting.displaySprite.visible = this.darkOverlayEnabled
      if (!this.darkOverlayEnabled) this.lighting.clear()
    }
    if (this.darkOverlayEnabled) this.updateLighting(objects)
  }

  private updateLighting(objects: RoomObjectMap): void {
    this.lighting.setLights(buildLights(objects))
    this.lighting.render()
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

  // MultiRoomRenderer calls this right after creating the scene, before the
  // ObjectLayer exists — stashed and applied once applyUpdate creates it.
  setNeighborLookup(fn: ((creepId: string, dirX: number, dirY: number) => { x: number; y: number } | null) | null): void {
    this.pendingNeighborLookup = fn
    this.objLayer?.setNeighborLookup(fn)
  }

  /** See ObjectLayer.getFreshArrival — queried by an adjacent room's lookup. */
  getFreshArrival(creepId: string): { x: number; y: number } | null {
    return this.objLayer?.getFreshArrival(creepId) ?? null
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
    this.root.removeChild(this.visualLayer.container)
    this.visualLayer.destroy()
    this.root.removeChild(this.lighting.displaySprite)
    this.lighting.destroy()
    this.root.removeChild(this.hoverLayer.container)
    this.hoverLayer.destroy()
    this.root.removeFromParent()
    this.root.destroy({ children: false })
  }
}
