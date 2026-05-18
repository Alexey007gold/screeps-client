import { createEffect, createSignal, onCleanup, onMount, untrack } from 'solid-js'

import { RoomRenderer } from '~/renderer/RoomRenderer.js'
import { createTerrainLayer } from '~/renderer/TerrainLayer.js'
import { ObjectLayer } from '~/renderer/ObjectLayer.js'
import { ActionAnimationLayer } from '~/renderer/ActionAnimationLayer.js'
import { VisualLayer } from '~/renderer/VisualLayer.js'
import { client, gameTime, setGameTime, recordGameTime, tickDuration, worldBounds, userInfo } from '~/stores/clientStore.js'
import { showCreepLabels } from '~/stores/settingsStore.js'
import { setSelection, clearSelection, selection, updateSelectionWithDiff } from '~/stores/selectionStore.js'
import { setRoomObjectCount } from '~/stores/roomDataStore.js'
import { parseRoomName, formatRoomName, isRoomInWorld } from '~/utils/roomName.js'
import { useRoomNavigationKeys } from '~/utils/useRoomNavigationKeys.js'
import type { RoomTerrain, RoomObjectMap, RoomObjectDiff } from 'screeps-connectivity'
import { SubscriptionGroup } from 'screeps-connectivity'

interface RoomViewerProps {
  room: string
  shard: string | null
  onNavigate?: (room: string, shard: string | null) => void
}

export function RoomViewer(props: RoomViewerProps) {
  let containerRef: HTMLDivElement | undefined
  let objLayer: ObjectLayer | null = null
  let animLayer: ActionAnimationLayer | null = null
  let visualLayer: VisualLayer | null = null
  let terrainLayerRef: ReturnType<typeof createTerrainLayer> | null = null
  const [renderer, setRenderer] = createSignal<RoomRenderer | null>(null)
  const [terrain, setTerrain] = createSignal<RoomTerrain | null>(null)
  const [objectState, setObjectState] = createSignal<{ objects: RoomObjectMap, diff?: RoomObjectDiff } | null>(null)
  const [visualState, setVisualState] = createSignal<string>('')

  onMount(async () => {
    if (!containerRef) return
    const r = await RoomRenderer.create(containerRef)
    setRenderer(r)
  })

  onCleanup(() => {
    objLayer?.destroy()
    objLayer = null
    animLayer?.destroy()
    animLayer = null
    visualLayer?.destroy()
    visualLayer = null
    const r = renderer()
    if (r) r.destroy()
  })

  // Subscribe to room data as soon as client is ready (no renderer dependency to avoid
  // a race where PixiJS init finishes after the initial room state arrives)
  createEffect(() => {
    const c = client()
    if (!c) return

    const room = props.room
    const shard = props.shard

    console.log(`[room] navigate → ${room} (shard=${shard ?? 'default'})`)
    setTerrain(null)
    setObjectState(null)
    setVisualState('')
    setGameTime(null)
    clearSelection()
    setRoomObjectCount(null)

    const group = new SubscriptionGroup()

    let terrainCancelled = false
    c.stores.room.terrain(room, shard)
      .then((t) => {
        if (!terrainCancelled) {
          console.log(`[room] terrain loaded — ${room}`)
          setTerrain(t)
        }
      })
      .catch((err) => { if (!terrainCancelled) console.error(`[room] terrain load failed for ${room}:`, err) })

    group.add(c.stores.room.subscribe(room, shard))
    group.add(c.stores.room.on('room:update', (data) => {
      if (!data.diff) {
        console.log(`[room] objects loaded — ${room}: ${Object.keys(data.objects).length} objects, tick=${data.gameTime}`)
      }
      setObjectState({ objects: data.objects, diff: data.diff })
      setVisualState(data.visual)
      setGameTime(data.gameTime ?? null)
      recordGameTime(data.gameTime)
      setRoomObjectCount(Object.keys(data.objects).length)
    }))

    onCleanup(() => {
      console.log(`[room] leaving ${room}`)
      terrainCancelled = true
      group.dispose()
    })
  })

  // Clear and reset when renderer or room changes (worldBounds intentionally NOT tracked here
  // — it arriving after login must not re-clear the scene and lose the terrain layer)
  createEffect(() => {
    const r = renderer()
    if (!r) return

    props.room
    props.shard

    terrainLayerRef?.destroy()
    terrainLayerRef = null
    r.clear()
    r.resetView()
    objLayer?.destroy()
    objLayer = null
    animLayer?.destroy()
    animLayer = null
    visualLayer?.destroy()
    visualLayer = null

    // Apply terrain immediately if it arrived before this clear ran
    const t = untrack(terrain)
    if (t) {
      console.log(`[room] terrain applied immediately (pre-loaded) — ${props.room}`)
      terrainLayerRef = createTerrainLayer(t)
      r.world.addChildAt(terrainLayerRef, 0)
      r.bringNavOverlayToTop()
    }
  })

  // Setup navigation zones — separate effect so worldBounds updates only re-wire
  // nav callbacks without triggering a full scene clear
  createEffect(() => {
    const r = renderer()
    if (!r) return

    const room = props.room
    const shard = props.shard
    const coord = parseRoomName(room)

    if (coord && props.onNavigate) {
      const nav = props.onNavigate
      const bounds = worldBounds()
      const canNavigate = (tx: number, ty: number) =>
        !bounds || isRoomInWorld(tx, ty, bounds)

      const navTo = (target: string) => {
        console.log(`[room] navigate requested: ${props.room} → ${target}`)
        nav(target, shard)
      }

      useRoomNavigationKeys({
        currentRoom: () => props.room,
        worldBounds,
        onMove: (rx, ry) => navTo(formatRoomName(rx, ry)),
      })

      r.setupNavigationZones({
        west:  canNavigate(coord.x - 1, coord.y) ? () => navTo(formatRoomName(coord.x - 1, coord.y)) : undefined,
        east:  canNavigate(coord.x + 1, coord.y) ? () => navTo(formatRoomName(coord.x + 1, coord.y)) : undefined,
        north: canNavigate(coord.x, coord.y - 1) ? () => navTo(formatRoomName(coord.x, coord.y - 1)) : undefined,
        south: canNavigate(coord.x, coord.y + 1) ? () => navTo(formatRoomName(coord.x, coord.y + 1)) : undefined,
      })
    }
  })

  // Apply terrain when it changes; skip if the clear-effect already applied it
  createEffect(() => {
    const r = renderer()
    const t = terrain()
    if (!r || !t) return
    if (terrainLayerRef?.parent) {
      console.log(`[room] terrain already in scene, skipping — ${props.room}`)
      return
    }
    console.log(`[room] terrain applied (async) — ${props.room}`)
    terrainLayerRef = createTerrainLayer(t)
    r.world.addChildAt(terrainLayerRef, 0)
    r.bringNavOverlayToTop()
  })

  // Render objects when they update
  createEffect(() => {
    const r = renderer()
    const state = objectState()
    if (!r || !state) return

    const { objects: objs, diff } = state

    if (!objLayer) {
      console.log(`[room] object layer created — ${props.room}`)
      objLayer = new ObjectLayer(r.app.ticker, showCreepLabels(), userInfo()?._id, userInfo()?.badge)
      objLayer.container.label = 'objects'
      r.world.addChild(objLayer.container)
      r.bringNavOverlayToTop()

      animLayer = new ActionAnimationLayer(r.app.ticker)
      animLayer.container.label = 'animations'
      r.world.addChild(animLayer.container)

      visualLayer = new VisualLayer()
      r.world.addChild(visualLayer.container)
      r.bringNavOverlayToTop()

      // Wire up tile click → selection
      r.setTileHandlers(
        // hover: nothing extra needed beyond what HoverHighlightLayer does internally
        (_tx, _ty) => {},
        (tx, ty, ctrlKey) => {
          if (!objLayer) return
          const hits = objLayer.getObjectsAtTile(tx, ty)
          if (hits.length === 0) return

          let nextSelection = [...selection()]

          if (ctrlKey) {
            // Ctrl+Click: if ANY object on the tile is already selected → deselect
            // those objects only; otherwise add all objects on the tile.
            const hitIds = new Set(hits.map(h => h.id))
            const hasSelected = nextSelection.some(s => hitIds.has(s.id))

            if (hasSelected) {
              // Deselect the objects on this tile
              nextSelection = nextSelection.filter(s => !hitIds.has(s.id))
            } else {
              // Add all objects on this tile
              const toAdd = hits
                .filter(({ id }) => !nextSelection.some(s => s.id === id))
                .map(({ id, obj }) => ({
                  id,
                  type: obj.type,
                  name: typeof obj.name === 'string' ? obj.name : undefined,
                  x: obj.x,
                  y: obj.y,
                  raw: obj,
                }))
              nextSelection = [...nextSelection, ...toAdd]
            }
          } else {
            // Normal click: replace selection with objects on this tile
            nextSelection = hits.map(({ id, obj }) => ({
              id,
              type: obj.type,
              name: typeof obj.name === 'string' ? obj.name : undefined,
              x: obj.x,
              y: obj.y,
              raw: obj,
            }))
          }

          setSelection(nextSelection)

          // Rebuild visual overlays from the full new selection
          const visuals = nextSelection
            .map(({ id, type }) => ({
              id,
              type,
              visual: objLayer!.getVisualById(id)!,
            }))
            .filter(v => v.visual != null)
          r.hoverLayer.setSelectedObjects(visuals)
        },
      )
    }

    if (diff) {
      updateSelectionWithDiff(diff, objs)
    }

    objLayer.update(objs, diff)

    if (animLayer) {
      animLayer.clear()
      const duration = (tickDuration() ?? 2000) * 0.6
      for (const [, obj] of Object.entries(objs)) {
        if (!obj || obj.type !== 'creep') continue
        const actionLog = obj.actionLog as Record<string, { x: number; y: number } | null> | null | undefined
        if (!actionLog) continue

        if (actionLog.harvest) {
          const target = actionLog.harvest
          animLayer.addHarvest(target.x, target.y, obj.x, obj.y, duration)
        }
        if (actionLog.upgradeController) {
          const target = actionLog.upgradeController
          animLayer.addUpgradeController(obj.x, obj.y, target.x, target.y, duration)
        }
      }
    }
  })

  // Update RoomVisuals overlay each tick (layer is created in the objects effect).
  // Read visualState() before the optional chain so SolidJS always tracks it,
  // even when visualLayer hasn't been created yet.
  createEffect(() => {
    const raw = visualState()
    visualLayer?.update(raw)
  })

  // Sync creep label visibility when the setting changes
  createEffect(() => {
    objLayer?.setShowLabels(showCreepLabels())
  })

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {gameTime() !== null && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            padding: '4px 10px',
            'border-radius': '4px',
            background: 'rgba(13, 17, 23, 0.8)',
            border: '1px solid #30363d',
            'font-size': '12px',
            color: '#8b949e',
          }}
        >
          Tick {gameTime()}
        </div>
      )}
    </div>
  )
}
