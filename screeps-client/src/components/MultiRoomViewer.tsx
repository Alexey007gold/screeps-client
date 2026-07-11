import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { MultiRoomRenderer, MAP2_MIN_ZOOM, FULL_DETAIL_ZOOM_THRESHOLD } from '~/renderer/MultiRoomRenderer.js'
import { FullDetailRoomCoordinator } from '~/renderer/FullDetailRoomCoordinator.js'
import type { SelectionVisual } from '~/renderer/HoverHighlightLayer.js'
import { client, userInfo, worldBounds, setWorldBounds, tickDuration, recordGameTime, isPrivateServer } from '~/stores/clientStore.js'
import { showCreepLabels, showRoomVisuals, roomDarkOverlay, showRoomDecorations } from '~/stores/settingsStore.js'
import { parseRoomDecorations } from '~/renderer/roomDecorations.js'
import { selection, setSelection, createSelectedObject, updateSelectionWithDiff, updateSelectionFromObjects } from '~/stores/selectionStore.js'
import {
  setRoomObjectCount, setRoomOwner, setControllerLevel, setControllerProgress,
  setControllerReservation, setStructureCounts, setRoomUsers, setCurrentRoom, setCurrentShard,
} from '~/stores/roomDataStore.js'
import { parseRoomName, isRoomInWorld } from '~/utils/roomName.js'
import type { Map2Subscription, Subscription, RoomObjectMap } from 'screeps-connectivity'


export interface MultiRoomViewerApi {
  setZoom: (zoom: number) => void
}

interface MultiRoomViewerProps {
  shard: string | null
  originRoom?: string
  initialZoom?: number
  onNavigateToRoom: (room: string) => void
  onHoveredRoomChanged?: (room: string | null) => void
  onSelectedRoomChanged?: (room: string | null) => void
  onZoomChanged?: (zoom: number) => void
  onFullDetailCountChanged?: (count: number) => void
  onReady?: (api: MultiRoomViewerApi) => void
}

export function MultiRoomViewer(props: MultiRoomViewerProps) {
  let canvasRef: HTMLCanvasElement | undefined
  let renderer: MultiRoomRenderer | null = null

  const [visibleRooms, setVisibleRooms] = createSignal<string[]>([])
  const [inViewRooms, setInViewRooms] = createSignal<ReadonlySet<string>>(new Set())
  const [zoom, setZoom] = createSignal(1)
  const origin = () => props.originRoom
  const [selectedRoom, setSelectedRoom] = createSignal<string | null>(origin() ?? null)
  let lastSubsActive: boolean | null = null

  // key = `${room}/${shard}` so shard changes invalidate existing subs
  const map2Subs = new Map<string, Map2Subscription>()

  // Rooms currently promoted to full detail, and their room.subscribe() handles.
  // Keyed by room name alone (like the renderer's own maps) — cleared wholesale
  // on shard change since room names collide across shards.
  const fullDetailSet = new Set<string>()
  const roomSubs = new Map<string, Subscription>()

  // Abstracts away whether a full-detail room lands on the single app connection
  // (private servers, where the subscription limit is account-wide and pooling
  // wouldn't help) or a pooled secondary (official server, where the limit is
  // per-connection) — see docs/project/Room Subscription Limit Investigation.md.
  const roomPool = new FullDetailRoomCoordinator({
    getPrimary: () => client(),
    isPrivate: () => isPrivateServer(),
  })

  const canNavigateTo = (room: string): boolean => {
    const bounds = worldBounds()
    if (!bounds) return true
    const coord = parseRoomName(room)
    return !!coord && isRoomInWorld(coord.x, coord.y, bounds)
  }

  // roomDataStore is a single global singleton (see RoomViewer) — in the grid
  // it's only ever populated for `selectedRoom`, the room owning the current
  // object selection (or the last clicked room). Mirrors RoomViewer's per-tick
  // summary computation (owner/RCL/counts/users) exactly.
  const applyRoomSummary = (objects: RoomObjectMap, users?: Record<string, { _id: string; username: string }>) => {
    let objectCount = 0
    const structCounts: Record<string, number> = {}
    let ctrlLevel = 0
    let ctrlProgress: number | null = null
    let owner: { userId: string; username: string } | null = null
    let reservation: { user: string; endTime: number } | null = null

    for (const id in objects) {
      objectCount++
      const obj = objects[id]
      if (!obj) continue
      const objType = obj.type
      if (typeof objType === 'string') {
        if (objType === 'constructionSite') {
          const structureType = obj.structureType
          if (typeof structureType === 'string') structCounts[structureType] = (structCounts[structureType] || 0) + 1
        } else {
          structCounts[objType] = (structCounts[objType] || 0) + 1
        }
      }
      if (objType === 'controller') {
        if (typeof obj.user === 'string') {
          const userId = obj.user
          const username = users?.[userId]?.username ?? userId
          owner = { userId, username }
          if (typeof obj.level === 'number') ctrlLevel = obj.level
          if (typeof obj.progress === 'number') ctrlProgress = obj.progress
        }
        const res = obj.reservation as { user: string; endTime: number } | undefined
        if (res && typeof res.user === 'string' && typeof res.endTime === 'number') {
          reservation = { user: res.user, endTime: res.endTime }
        }
      }
    }

    setRoomObjectCount(objectCount)
    setRoomOwner(owner)
    setControllerLevel(ctrlLevel || null)
    setControllerProgress(ctrlProgress)
    setControllerReservation(reservation)
    setStructureCounts(structCounts)
    setRoomUsers(users ?? null)
  }

  const resetRoomSummary = () => {
    setRoomObjectCount(null)
    setRoomOwner(null)
    setControllerLevel(null)
    setControllerProgress(null)
    setControllerReservation(null)
    setStructureCounts({})
    setRoomUsers(null)
  }

  const demoteFullDetail = (room: string) => {
    fullDetailSet.delete(room)
    roomSubs.get(room)?.dispose()
    roomSubs.delete(room)
    renderer?.removeFullDetailRoom(room)
    // A demoted room's subscription is gone, so it can never refresh the info
    // panel again — drop the selection rather than leave it frozen on stale data.
    if (selectedRoom() === room) {
      setSelection([])
      resetRoomSummary()
      setSelectedRoom(null)
      setCurrentRoom(null)
      props.onSelectedRoomChanged?.(null)
    }
  }

  // Promoting/demoting full-detail rooms is expensive (ObjectLayer create/destroy),
  // so a mid-pinch or mid-scroll-wheel zoom must not thrash it on every frame.
  // Settle for a beat after the last visibleRooms/zoom change before recomputing
  // the desired set — cheap layers (terrain/map2) stay on the fast path above.
  const FULL_DETAIL_SETTLE_MS = 80
  let fullDetailTimer: ReturnType<typeof setTimeout> | null = null

  const scheduleFullDetailReconcile = (rooms: string[], inView: ReadonlySet<string>, shard: string | null) => {
    if (fullDetailTimer !== null) clearTimeout(fullDetailTimer)
    fullDetailTimer = setTimeout(() => {
      fullDetailTimer = null
      const c = client()
      if (!c) return

      // Only rooms actually on screen are candidates — the scroll-ahead buffer
      // (rooms in `rooms` but not `inView`) never gets promoted to full detail.
      const candidates = rooms.filter((r) => inView.has(r))
      const desired = zoom() >= FULL_DETAIL_ZOOM_THRESHOLD
        ? candidates.slice().sort((a, b) => {
            const cx = candidates.reduce((s, r) => s + (parseRoomName(r)?.x ?? 0), 0) / candidates.length
            const cy = candidates.reduce((s, r) => s + (parseRoomName(r)?.y ?? 0), 0) / candidates.length
            const ca = parseRoomName(a), cb = parseRoomName(b)
            const da = ca ? Math.abs(ca.x - cx) + Math.abs(ca.y - cy) : 999
            const db = cb ? Math.abs(cb.x - cx) + Math.abs(cb.y - cy) : 999
            return da - db
          }).slice(0, roomPool.capacity())
        : []
      const desiredSet = new Set(desired)

      for (const room of [...fullDetailSet]) {
        if (!desiredSet.has(room)) demoteFullDetail(room)
      }
      for (const room of desired) {
        if (fullDetailSet.has(room)) continue
        fullDetailSet.add(room)
        renderer?.createFullDetailRoom(room)
        roomSubs.set(room, roomPool.subscribeFullDetailRoom(room, shard))
        // Terrain is almost always already cached (the base-layer terrainBulk
        // fetch reconciles first) — this just reads that cache in the common case.
        c.stores.room.terrain(room, shard, { silent: true })
          .then((t) => renderer?.applyFullDetailTerrain(room, t))
          .catch(() => {})

        if (showRoomDecorations()) {
          c.http.game.roomDecorations(room, shard)
            .then((resp) => renderer?.applyFullDetailDecoration(room, parseRoomDecorations(resp)))
            .catch(() => {})
        }
      }

      props.onFullDetailCountChanged?.(fullDetailSet.size)
    }, FULL_DETAIL_SETTLE_MS)
  }

  // Terrain is fetched progressively in batches, sorted center-out — mirrors MapViewer.
  const TERRAIN_BATCH_SIZE = 200
  const TERRAIN_BATCH_MS = 0
  let terrainQueue: string[] = []
  let terrainTimer: ReturnType<typeof setTimeout> | null = null
  const requested = new Set<string>()

  const drainTerrain = () => {
    terrainTimer = null
    const c = client()
    if (!c || !renderer) return
    const vis = new Set(visibleRooms())
    terrainQueue = terrainQueue.filter(r => vis.has(r) && !renderer!.hasRoom(r) && !requested.has(r))
    if (terrainQueue.length === 0) return
    const batch = terrainQueue.splice(0, TERRAIN_BATCH_SIZE)
    for (const r of batch) requested.add(r)
    c.stores.room.terrainBulk(batch, props.shard, { silent: true })
      .then(async terrainMap => {
        const bakes: Promise<void>[] = []
        for (const [room, terrain] of terrainMap) {
          const p = renderer?.setRoomTerrain(room, terrain)
          if (p) bakes.push(p)
        }
        for (const room of batch) {
          if (!terrainMap.has(room)) renderer?.markRoomFetched(room)
        }
        await Promise.all(bakes)
      })
      .catch(() => {})
      .finally(() => {
        for (const r of batch) requested.delete(r)
        if (terrainQueue.length > 0) terrainTimer = setTimeout(drainTerrain, TERRAIN_BATCH_MS)
      })
  }

  // Drop rendered terrain + subs when connection or shard changes — room names
  // collide across shards, so the renderer's cache must be force-cleared.
  createEffect(() => {
    client()
    void props.shard
    requested.clear()
    for (const sub of map2Subs.values()) sub.dispose()
    map2Subs.clear()
    // Cancel any pending reconcile — it closes over the previous shard and
    // would otherwise resurrect full-detail rooms for it right after this
    // synchronous teardown.
    if (fullDetailTimer !== null) { clearTimeout(fullDetailTimer); fullDetailTimer = null }
    for (const room of [...fullDetailSet]) demoteFullDetail(room)
    roomPool.reset()
    renderer?.clearAllRooms()
    props.onFullDetailCountChanged?.(fullDetailSet.size)
  })

  // Moves the "room of interest" (info panel + object selection ownership) to
  // a new room. Clears the old room's selection outline and the previous
  // summary so nothing stale lingers while the new room's data streams in.
  const selectRoom = (room: string | null) => {
    if (selectedRoom() === room) return
    const prev = selectedRoom()
    if (prev) renderer?.setFullDetailSelectedObjects(prev, [])
    setSelection([])
    resetRoomSummary()
    setSelectedRoom(room)
    setCurrentRoom(room)
    setCurrentShard(props.shard)
    props.onSelectedRoomChanged?.(room)
  }

  onMount(() => {
    if (!canvasRef) return

    ;(async () => {
      renderer = new MultiRoomRenderer({
        onRoomHover: (room) => props.onHoveredRoomChanged?.(room),
        onRoomClick: (room) => {
          if (selectedRoom() !== room) {
            selectRoom(room)
          } else {
            // Defer navigation out of the PixiJS event handler — see MapViewer for why
            // (calling synchronously would unmount this component mid-pointer-pipeline).
            if (canNavigateTo(room)) setTimeout(() => props.onNavigateToRoom(room), 0)
          }
        },
        onTileClick: (room, tx, ty, ctrlKey) => {
          if (!renderer) return
          const sameRoom = selectedRoom() === room
          const hits = renderer.getFullDetailObjectsAtTile(room, tx, ty)

          if (hits.length === 0) {
            // Empty-tile click: ctrl+click preserves the selection (mirrors
            // RoomViewer); a plain click clears it. selectRoom() no-ops when
            // `room` is already selected, so the clear must happen explicitly
            // too — otherwise clicking empty space in the current room would
            // silently do nothing instead of deselecting.
            if (!ctrlKey) {
              if (sameRoom) {
                setSelection([])
                renderer.setFullDetailSelectedObjects(room, [])
              } else {
                selectRoom(room)
              }
            }
            return
          }

          if (!sameRoom) selectRoom(room)

          let nextSelection = sameRoom ? [...selection()] : []
          if (ctrlKey && sameRoom) {
            const hitIds = new Set(hits.map(h => h.id))
            const hasSelected = nextSelection.some(s => hitIds.has(s.id))
            nextSelection = hasSelected
              ? nextSelection.filter(s => !hitIds.has(s.id))
              : [...nextSelection, ...hits.filter(({ id }) => !nextSelection.some(s => s.id === id)).map(({ id, obj }) => createSelectedObject(id, obj))]
          } else {
            nextSelection = hits.map(({ id, obj }) => createSelectedObject(id, obj))
          }

          setSelection(nextSelection)
          const visuals = nextSelection
            .map(({ id, type }) => ({ id, type, visual: renderer!.getFullDetailVisualById(room, id) }))
            .filter((v): v is SelectionVisual => v.visual != null)
          renderer.setFullDetailSelectedObjects(room, visuals)
        },
        onVisibleRoomsChanged: (rooms, inView) => {
          setVisibleRooms(rooms)
          setInViewRooms(inView)
        },
        onZoomChanged: (z) => {
          setZoom(z)
          props.onZoomChanged?.(z)
        },
      })

      await renderer.init(canvasRef!)
      if (!renderer) return
      if (props.initialZoom !== undefined && props.initialZoom > 0) {
        renderer.setZoom(props.initialZoom)
      }
      props.onZoomChanged?.(renderer.zoom)
      props.onReady?.({ setZoom: (z) => renderer?.setZoom(z) })
      const initialBounds = worldBounds()
      if (initialBounds) renderer.setBounds(initialBounds.minX, initialBounds.maxX, initialBounds.minY, initialBounds.maxY)

      if (props.originRoom) {
        const coord = parseRoomName(props.originRoom)
        if (coord) renderer.centerOn(coord.x, coord.y)
        props.onSelectedRoomChanged?.(props.originRoom)
      } else {
        const c = client()
        if (c) {
          try {
            const res = await c.http.user.worldStartRoom(props.shard ?? 'shard0') as { room?: string | string[] }
            if (!renderer) return
            const roomName = Array.isArray(res?.room) ? res.room[0] : res?.room
            if (typeof roomName === 'string') {
              const coord = parseRoomName(roomName)
              if (coord) renderer.centerOn(coord.x, coord.y)
            }
          } catch {
            /* ignored */
          }
        }
      }
    })()
  })

  onCleanup(() => {
    if (terrainTimer !== null) { clearTimeout(terrainTimer); terrainTimer = null }
    if (fullDetailTimer !== null) { clearTimeout(fullDetailTimer); fullDetailTimer = null }
    terrainQueue = []
    requested.clear()
    for (const sub of map2Subs.values()) sub.dispose()
    map2Subs.clear()
    for (const sub of roomSubs.values()) sub.dispose()
    roomSubs.clear()
    fullDetailSet.clear()
    roomPool.dispose()
    renderer?.destroy()
    renderer = null
  })

  // Fetch terrain, manage map2 subscriptions when visible rooms/zoom/shard change
  createEffect(() => {
    const c = client()
    let rooms = visibleRooms()
    const inView = inViewRooms()
    const shard = props.shard
    if (!c || rooms.length === 0) return

    // Filter out rooms outside world bounds (important for private servers with smaller maps)
    const bounds = worldBounds()
    if (bounds) {
      rooms = rooms.filter(r => {
        const coord = parseRoomName(r)
        return coord && isRoomInWorld(coord.x, coord.y, bounds)
      })
    }

    const visibleSet = new Set(rooms)

    const newRooms = rooms.filter(r => !renderer?.hasRoom(r) && !requested.has(r))
    if (newRooms.length > 0) {
      const cx = rooms.reduce((s, r) => s + (parseRoomName(r)?.x ?? 0), 0) / rooms.length
      const cy = rooms.reduce((s, r) => s + (parseRoomName(r)?.y ?? 0), 0) / rooms.length
      terrainQueue = newRooms.slice().sort((a, b) => {
        const ca = parseRoomName(a), cb = parseRoomName(b)
        const da = ca ? Math.abs(ca.x - cx) + Math.abs(ca.y - cy) : 999
        const db = cb ? Math.abs(cb.x - cx) + Math.abs(cb.y - cy) : 999
        return da - db
      })
      if (terrainTimer === null) terrainTimer = setTimeout(drainTerrain, 0)
    }

    // Reconcile map2 subscriptions — drop all when zoomed too far out.
    // The library (MapStore) handles its own per-server limit via a waitlist.
    const subsActive = zoom() >= MAP2_MIN_ZOOM
    if (subsActive !== lastSubsActive) {
      lastSubsActive = subsActive
      if (!subsActive) renderer?.clearAllMap2()
    }
    if (!subsActive) {
      for (const [, sub] of map2Subs) sub.dispose()
      map2Subs.clear()
    } else {
      const activeKeys = new Set(rooms.map((r) => `${r}/${shard}`))
      for (const [key, sub] of map2Subs) {
        if (!activeKeys.has(key)) {
          sub.dispose()
          map2Subs.delete(key)
          renderer?.clearRoomMap2(key.split('/')[0])
        }
      }
      for (const room of rooms) {
        const key = `${room}/${shard}`
        if (!map2Subs.has(key)) {
          map2Subs.set(key, c.stores.map.subscribeMap2(room, shard))
        }
      }
    }

    // Reconcile full-detail rooms on a short settle delay — see
    // scheduleFullDetailReconcile for why this must NOT run synchronously here.
    scheduleFullDetailReconcile(rooms, inView, shard)

    renderer?.clearInvisibleRooms(visibleSet)
  })

  // Single room:update listener shared by every full-detail room, funneled by
  // roomPool from whichever connection (primary or a pooled secondary) actually
  // carries each room — mirrors the map2 listener above. Filtering by
  // fullDetailSet membership (rather than one listener per room) avoids N
  // redundant listeners firing on every socket message.
  onMount(() => {
    // eslint-disable-next-line solid/reactivity
    const sub = roomPool.onRoomUpdate((data) => {
      if (data.shard !== props.shard) return
      if (!fullDetailSet.has(data.room)) return

      // Capture before applying — becomes false→true exactly on this room's
      // first snapshot, telling us whether `data.diff` is safe to merge or
      // must be treated as a full reconcile (mirrors RoomViewer's isFirstUpdate).
      const hadObjectLayer = renderer?.hasFullDetailObjects(data.room) ?? false

      recordGameTime(data.gameTime)
      const tickMs = tickDuration() ?? 2000
      renderer?.applyFullDetailUpdate(data.room, data.objects, data.diff, {
        showLabels: showCreepLabels(),
        currentUserId: userInfo()?._id,
        currentUserBadge: userInfo()?.badge,
        users: data.users,
        gameTime: data.gameTime,
        moveDuration: Math.round(tickMs * 0.9),
        tickDuration: tickMs,
        visual: data.visual,
        showRoomVisuals: showRoomVisuals(),
        darkOverlayEnabled: roomDarkOverlay(),
      })

      // Only the room owning the current selection may touch the global
      // selection/roomData stores — otherwise a tick from an unrelated visible
      // room would wrongly drop another room's selection (updateSelectionFromObjects
      // treats any id missing from its `objects` argument as removed).
      if (selectedRoom() !== data.room) return
      if (hadObjectLayer && data.diff) updateSelectionWithDiff(data.diff, data.objects)
      else updateSelectionFromObjects(data.objects)
      applyRoomSummary(data.objects, data.users)
    })

    onCleanup(() => sub.dispose())
  })

  // Sync current shard onto the renderer (used for terrain cache keys)
  createEffect(() => {
    if (renderer) renderer.currentShard = props.shard ?? 'shard0'
  })

  // Sync current user ID so map2 dots use the right colour
  createEffect(() => {
    renderer?.setCurrentUser(userInfo()?._id ?? null)
  })

  // map2 update listener — re-wired if client reconnects
  createEffect(() => {
    const c = client()
    if (!c) return

    // eslint-disable-next-line solid/reactivity
    const sub = c.stores.map.on('room:map2update', ({ room, shard, data, source }) => {
      if (shard !== props.shard) return
      renderer?.setRoomMap2(room, data, source)
    })

    onCleanup(() => sub.dispose())
  })

  // Fetch world bounds with the correct shard whenever client or shard changes.
  createEffect(() => {
    const c = client()
    const shard = props.shard
    if (!c) return
    c.stores.server.worldInfo(shard ?? undefined).then((info) => {
      setWorldBounds(info)
    }).catch(() => {})
  })

  // Apply/clear world bounds border when the worldBounds signal updates.
  createEffect(() => {
    const bounds = worldBounds()
    if (!bounds) {
      renderer?.clearBounds()
    } else {
      renderer?.setBounds(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY)
    }
  })

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas ref={(el) => canvasRef = el} style={{ display: 'block' }} />
    </div>
  )
}
