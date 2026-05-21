import { createEffect, createSignal, onCleanup, onMount, untrack } from 'solid-js'

import { RoomRenderer } from '~/renderer/RoomRenderer.js'
import { createTerrainLayer } from '~/renderer/TerrainLayer.js'
import { ObjectLayer } from '~/renderer/ObjectLayer.js'
import { ActionAnimationLayer } from '~/renderer/ActionAnimationLayer.js'
import { VisualLayer } from '~/renderer/VisualLayer.js'
import { client, gameTime, setGameTime, recordGameTime, tickDuration, worldBounds, userInfo, worldStatus } from '~/stores/clientStore.js'
import { showCreepLabels } from '~/stores/settingsStore.js'
import { setSelection, clearSelection, selection, updateSelectionWithDiff, createSelectedObject } from '~/stores/selectionStore.js'
import { addToast } from '~/stores/toastStore.js'
import { setRoomObjectCount, setRoomOwner, setControllerLevel, setStructureCounts } from '~/stores/roomDataStore.js'
import { parseRoomName, formatRoomName, isRoomInWorld } from '~/utils/roomName.js'
import { useRoomNavigationKeys } from '~/utils/useRoomNavigationKeys.js'
import type { RoomTerrain, RoomObjectMap, RoomObjectDiff } from 'screeps-connectivity'
import { SubscriptionGroup } from 'screeps-connectivity'
import {flagDraft, roomViewMode, FLAG_COLOR_MAP, pendingTile, setPendingTile, clearPendingTile, setFlagDraft, modeHint, overlayAction, clearOverlayAction, buildDraft, confirmBuild, resetRoomViewMode} from '~/stores/roomViewStore';

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
  const [terrain, setTerrain] = createSignal<{ room: string, data: RoomTerrain } | null>(null)
  const [objectState, setObjectState] = createSignal<{ objects: RoomObjectMap, diff?: RoomObjectDiff, users?: Record<string, { _id: string; username: string }> } | null>(null)
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
    setRoomOwner(null)
    setControllerLevel(null)
    setStructureCounts({})

    const group = new SubscriptionGroup()

    let terrainCancelled = false
    c.stores.room.terrain(room, shard)
      .then((t) => {
        if (!terrainCancelled) {
          console.log(`[room] terrain loaded — ${room}`)
          setTerrain({ room, data: t })
        }
      })
      .catch((err) => { if (!terrainCancelled) console.error(`[room] terrain load failed for ${room}:`, err) })

    group.add(c.stores.room.subscribe(room, shard))
    group.add(c.stores.room.on('room:error', (data) => {
      addToast(`Room subscription error (${data.room}): ${data.message}`, 'error', 8000)
    }))
    group.add(c.stores.room.on('room:update', (data) => {
      // Use for...in to count keys without allocating an array, avoiding memory allocations on hot path
      let objectCount = 0
      // Structure counts for build mode: track actual structures + construction sites
      const structCounts: Record<string, number> = {}
      let ctrlLevel = 0

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for (const _k in data.objects) { objectCount++ }

      if (!data.diff) {
        console.log(`[room] objects loaded — ${room}: ${objectCount} objects, tick=${data.gameTime}`)
      }
      setObjectState({ objects: data.objects, diff: data.diff, users: data.users })
      setVisualState(data.visual)
      setGameTime(data.gameTime ?? null)
      recordGameTime(data.gameTime)
      setRoomObjectCount(objectCount)

      // Extract room owner from controller and count structures
      let owner: { userId: string; username: string } | null = null
      for (const obj of Object.values(data.objects)) {
        if (!obj) continue

        // Count structures by type
        const objType = obj.type
        if (typeof objType === 'string') {
          if (objType === 'constructionSite') {
            // Count construction sites by their structureType
            const structureType = obj.structureType
            if (typeof structureType === 'string') {
              structCounts[structureType] = (structCounts[structureType] || 0) + 1
            }
          } else {
            structCounts[objType] = (structCounts[objType] || 0) + 1
          }
        }

        // Extract controller info
        if (objType === 'controller' && typeof obj.user === 'string') {
          const userId = obj.user
          const username = data.users?.[userId]?.username ?? userId
          owner = { userId, username }
          if (typeof obj.level === 'number') {
            ctrlLevel = obj.level
          }
        }
      }
      setRoomOwner(owner)
      setControllerLevel(ctrlLevel || null)
      setStructureCounts(structCounts)
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

    void props.room
    void props.shard

    resetRoomViewMode()
    r.hoverLayer.clearPendingTile()

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
    if (t && t.room === props.room) {
      console.log(`[room] terrain applied immediately (pre-loaded) — ${props.room}`)
      terrainLayerRef = createTerrainLayer(t.data)
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

  // Clear pending marker when switching back to view mode
  createEffect(() => {
    const mode = roomViewMode()
    const r = renderer()
    if (mode === 'view' && r) {
      clearPendingTile()
      r.hoverLayer.clearPendingTile()
    }
  })

  // Sync pending tile changes to hoverLayer (e.g., when cleared from Sidebar)
  createEffect(() => {
    const r = renderer()
    const pending = pendingTile()
    if (!r) return
    if (pending) {
      r.hoverLayer.setPendingTile(pending.tx, pending.ty)
    } else {
      r.hoverLayer.clearPendingTile()
    }
  })

  // Apply terrain when it changes; skip if the clear-effect already applied it
  createEffect(() => {
    const r = renderer()
    const t = terrain()
    if (!r || !t || t.room !== props.room) return

    if (terrainLayerRef?.parent) {
      console.log(`[room] terrain already in scene, skipping — ${props.room}`)
      return
    }
    console.log(`[room] terrain applied (async) — ${props.room}`)
    terrainLayerRef = createTerrainLayer(t.data)
    r.world.addChildAt(terrainLayerRef, 0)
    r.bringNavOverlayToTop()
  })

  // Render objects when they update
  createEffect(() => {
    const r = renderer()
    const state = objectState()
    if (!r || !state) return

    const { objects: objs, diff, users } = state

    if (!objLayer) {
      console.log(`[room] object layer created — ${props.room}`)
      objLayer = new ObjectLayer(r.app.ticker, showCreepLabels(), userInfo()?._id, userInfo()?.badge, users)
      objLayer.container.label = 'objects'
      r.world.addChild(objLayer.container)
      r.bringNavOverlayToTop()

      animLayer = new ActionAnimationLayer(r.app.ticker)
      animLayer.container.label = 'animations'
      r.world.addChild(animLayer.container)

      visualLayer = new VisualLayer()
      r.world.addChild(visualLayer.container)
      r.bringNavOverlayToTop()

      // Wire up tile click → current room interaction mode
      r.setTileHandlers(
          // hover: nothing extra needed beyond what HoverHighlightLayer does internally
          (_tx, _ty) => {},
          (tx, ty, ctrlKey) => {
            const mode = roomViewMode()

            const overlay = overlayAction()

            if (overlay?.type === 'moveFlag') {
              const c = client()
              if (!c) return

              const { name, room, color, secondaryColor } = overlay
              c.http.game.removeFlag(room, name)
                .then(() => {
                  return c.http.game.createFlag(
                    props.room, tx, ty, name, color, secondaryColor, props.shard ?? undefined
                  )
                })
                .then(() => {
                  addToast(`Flag "${name}" moved`, 'success')
                  clearOverlayAction()
                })
                .catch((err) => {
                  console.error('[room] move flag failed:', err)
                  addToast(`Failed to move flag "${name}"`, 'error')
                  clearOverlayAction()
                })
              return
            }

            if (mode === 'flag') {
              const pending = pendingTile()
              if (!pending || pending.tx !== tx || pending.ty !== ty) {
                setPendingTile({ tx, ty })
                r.hoverLayer.setPendingTile(tx, ty)
                return
              }

              const c = client()
              if (!c) return

              const draft = flagDraft()
              const name = draft.name.trim()
              if (!name) {
                addToast('Flag name is required', 'error')
                return
              }

              const color = FLAG_COLOR_MAP[draft.color] ?? 0
              const secondaryColor = FLAG_COLOR_MAP[draft.secondaryColor] ?? 0
              c.http.game.createFlag(props.room, tx, ty, name, color, secondaryColor, props.shard ?? undefined)
                  .then(() => {
                    addToast(`Flag "${name}" created`, 'success')
                    clearPendingTile()
                    r.hoverLayer.clearPendingTile()
                    c.http.game.genUniqueFlagName()
                        .then((res) => setFlagDraft(prev => ({ ...prev, name: res.name })))
                        .catch((err) => console.error('[room] gen unique flag name failed:', err))
                  })
                  .catch((err) => console.error('[room] create flag failed:', err))
              return
            }

            if (mode === 'build') {
              if (!ctrlKey && !buildDraft().structureType) {
                addToast('Select a structure type first', 'error')
                return
              }

              if (ctrlKey) {
                if (!objLayer) return
                const hits = objLayer.getObjectsAtTile(tx, ty)
                const sites = hits.filter(({ obj }) => obj.type === 'constructionSite')
                if (sites.length === 0) {
                  addToast('No construction sites on this tile', 'error')
                  return
                }
                const c = client()
                if (!c) return
                c.http.game.removeConstructionSite(props.room, sites.map(({ id }) => id), props.shard ?? undefined)
                  .then(() => {
                    addToast(`Removed ${sites.length} construction site${sites.length > 1 ? 's' : ''}`, 'success')
                    clearPendingTile()
                    r.hoverLayer.clearPendingTile()
                  })
                  .catch((err) => {
                    console.error('[room] remove construction sites failed:', err)
                    addToast(`Failed to remove construction sites: ${err.message}`, 'error')
                  })
                return
              }

              setPendingTile({ tx, ty })
              r.hoverLayer.setPendingTile(tx, ty)
              confirmBuild(props.room, props.shard)
              return
            }

            // view mode: clear any pending marker
            clearPendingTile()
            r.hoverLayer.clearPendingTile()

            if (!objLayer) return
            const hits = objLayer.getObjectsAtTile(tx, ty)

            if (hits.length === 0) {
              if (!ctrlKey) {
                setSelection([])
                r.hoverLayer.clearSelection()
              }
              return
            }

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
                    .map(({ id, obj }) => createSelectedObject(id, obj))
                nextSelection = [...nextSelection, ...toAdd]
              }
            } else {
              // Normal click: replace selection with objects on this tile
              nextSelection = hits.map(({ id, obj }) => createSelectedObject(id, obj))
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

    objLayer.update(objs, diff, users)

    if (animLayer) {
      animLayer.clear()
      const duration = (tickDuration() ?? 2000) * 0.6
      // Use for...in over Object.entries to avoid allocating a new array of arrays every tick
      for (const id in objs) {
        const obj = objs[id]
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
      <div ref={(el) => containerRef = el} style={{ width: '100%', height: '100%' }} />
      {modeHint() && (
        <div
          style={{
            position: 'absolute',
            top: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '6px 16px',
            'border-radius': '6px',
            background: 'rgba(13, 17, 23, 0.65)',
            border: '1px solid rgba(48, 54, 61, 0.6)',
            'font-size': '13px',
            'font-weight': 500,
            color: '#c9d1d9',
            'pointer-events': (worldStatus() === 'empty' || worldStatus() === 'lost') ? 'auto' : 'none',
            'user-select': 'none',
            'z-index': 10,
          }}
        >
          {modeHint()}
        </div>
      )}
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
            'z-index': 10,
          }}
        >
          Tick {gameTime()}
        </div>
      )}
    </div>
  )
}
