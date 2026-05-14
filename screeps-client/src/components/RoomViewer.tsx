import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { RoomRenderer } from '~/renderer/RoomRenderer.js'
import { createTerrainLayer } from '~/renderer/TerrainLayer.js'
import { ObjectLayer } from '~/renderer/ObjectLayer.js'
import { ActionAnimationLayer } from '~/renderer/ActionAnimationLayer.js'
import { client, gameTime, setGameTime, recordGameTime, tickDuration } from '~/stores/clientStore.js'
import { setSelection, clearSelection, selection, updateSelectionWithDiff } from '~/stores/selectionStore.js'
import { parseRoomName, formatRoomName } from '~/utils/roomName.js'
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
  const [renderer, setRenderer] = createSignal<RoomRenderer | null>(null)
  const [terrain, setTerrain] = createSignal<RoomTerrain | null>(null)
  const [objectState, setObjectState] = createSignal<{ objects: RoomObjectMap, diff?: RoomObjectDiff } | null>(null)

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
    const r = renderer()
    if (r) r.destroy()
  })

  // Load terrain and subscribe to room when room/shard changes
  createEffect(() => {
    const c = client()
    const r = renderer()
    if (!c || !r) return

    const room = props.room
    const shard = props.shard

    // Reset state
    setTerrain(null)
    setObjectState(null)
    setGameTime(null)
    clearSelection()
    r.clear()
    r.resetView()
    objLayer?.destroy()
    objLayer = null
    animLayer?.destroy()
    animLayer = null

    // Setup navigation zones + arrow-key navigation
    const coord = parseRoomName(room)
    const navHandlers = coord && props.onNavigate
      ? {
        west:  () => props.onNavigate!(formatRoomName(coord.x - 1, coord.y), shard),
        east:  () => props.onNavigate!(formatRoomName(coord.x + 1, coord.y), shard),
        north: () => props.onNavigate!(formatRoomName(coord.x, coord.y - 1), shard),
        south: () => props.onNavigate!(formatRoomName(coord.x, coord.y + 1), shard),
      }
      : null

    if (navHandlers) {
      r.setupNavigationZones(navHandlers)

      const onKeyDown = (e: KeyboardEvent) => {
        // Ignore when an input / textarea / contenteditable has focus
        const tag = (e.target as HTMLElement | null)?.tagName ?? ''
        const editable = (e.target as HTMLElement | null)?.isContentEditable ?? false
        if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return

        switch (e.key) {
          case 'ArrowLeft':  e.preventDefault(); navHandlers.west();  break
          case 'ArrowRight': e.preventDefault(); navHandlers.east();  break
          case 'ArrowUp':    e.preventDefault(); navHandlers.north(); break
          case 'ArrowDown':  e.preventDefault(); navHandlers.south(); break
        }
      }

      window.addEventListener('keydown', onKeyDown)
      onCleanup(() => window.removeEventListener('keydown', onKeyDown))
    }

    const group = new SubscriptionGroup()

    // Fetch terrain
    c.stores.room.terrain(room, shard)
      .then((t) => setTerrain(t))
      .catch((err) => console.error('Failed to load terrain:', err))

    // Fetch initial room objects
    c.stores.room.fetchObjects(room, shard)
      .catch((err) => console.error('Failed to load room objects:', room, shard, err))

    // Subscribe to room updates
    group.add(c.stores.room.subscribe(room, shard))

    group.add(c.stores.room.on('room:update', (data) => {
      setObjectState({ objects: data.objects, diff: data.diff })
      setGameTime(data.gameTime ?? null)
      recordGameTime(data.gameTime)
    }))

    onCleanup(() => {
      group.dispose()
    })
  })

  // Render terrain when it arrives
  createEffect(() => {
    const r = renderer()
    const t = terrain()
    if (!r || !t) return

    const layer = createTerrainLayer(t)
    r.world.addChild(layer)
    r.bringNavOverlayToTop()
  })

  // Render objects when they update
  createEffect(() => {
    const r = renderer()
    const state = objectState()
    if (!r || !state) return

    const { objects: objs, diff } = state

    if (!objLayer) {
      objLayer = new ObjectLayer(r.app.ticker)
      objLayer.container.label = 'objects'
      r.world.addChild(objLayer.container)
      r.bringNavOverlayToTop()

      animLayer = new ActionAnimationLayer(r.app.ticker)
      animLayer.container.label = 'animations'
      r.world.addChild(animLayer.container)
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
