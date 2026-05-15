import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { MapRenderer } from '~/renderer/MapRenderer.js'
import { client, userInfo, worldBounds } from '~/stores/clientStore.js'
import { showMapRoomNames } from '~/stores/settingsStore.js'
import { parseRoomName, formatRoomName, isRoomInWorld } from '~/utils/roomName.js'
import type { Subscription } from 'screeps-connectivity'

export interface RoomInfo {
  room: string
  owner: string | null
  mineral: string | null
  density: number | null
}

interface MapViewerProps {
  shard: string | null
  originRoom?: string
  onNavigateToRoom: (room: string) => void
  onHoveredRoomChanged?: (info: RoomInfo | null) => void
  onSelectedRoomChanged?: (info: RoomInfo | null) => void
}

export function MapViewer(props: MapViewerProps) {
  let canvasRef: HTMLCanvasElement | undefined
  let renderer: MapRenderer | null = null

  const [visibleRooms, setVisibleRooms] = createSignal<string[]>([])
  const [selectedRoom, setSelectedRoom] = createSignal<string | null>(props.originRoom ?? null)

  // key = `${room}/${shard}` so shard changes invalidate existing subs
  const map2Subs = new Map<string, Subscription>()

  const canNavigateTo = (room: string): boolean => {
    const bounds = worldBounds()
    if (!bounds) return true // server doesn't provide world-size → allow all
    const coord = parseRoomName(room)
    return !!coord && isRoomInWorld(coord.x, coord.y, bounds)
  }

  // Latest mapStats data for info box lookups — written async, read in hover handler
  let latestStats: Record<string, { own?: { user: string; level: number }; mineral?: string; density?: number }> = {}
  let latestUsers: Record<string, { username: string }> = {}

  const buildRoomInfo = (room: string): RoomInfo => {
    const stat = latestStats[room]
    const ownerId = stat?.own?.user
    const owner = ownerId ? (latestUsers[ownerId]?.username ?? ownerId) : null
    return { room, owner, mineral: stat?.mineral ?? null, density: stat?.density ?? null }
  }

  onMount(() => {
    if (!canvasRef) return

    let keyDownHandler: ((e: KeyboardEvent) => void) | null = null
    onCleanup(() => {
      if (keyDownHandler) window.removeEventListener('keydown', keyDownHandler)
    })

    ;(async () => {
      renderer = new MapRenderer({
        onRoomHover: (room) => {
          props.onHoveredRoomChanged?.(room ? buildRoomInfo(room) : null)
        },
        onRoomClick: (room) => {
          if (canNavigateTo(room)) props.onNavigateToRoom(room)
        },
        onVisibleRoomsChanged: (rooms) => {
          setVisibleRooms(rooms)
        },
      })

      await renderer.init(canvasRef!)
      if (!renderer) return
      // Apply world bounds immediately if already known (worldInfo arrived before renderer init)
      const initialBounds = worldBounds()
      if (initialBounds) renderer.setBounds(initialBounds.minX, initialBounds.maxX, initialBounds.minY, initialBounds.maxY)

      if (props.originRoom) {
        const coord = parseRoomName(props.originRoom)
        if (coord) renderer.centerOn(coord.x, coord.y)
        renderer.setSelectedRoom(props.originRoom)
        props.onSelectedRoomChanged?.(buildRoomInfo(props.originRoom))
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
          } catch (err) {
            console.error('[map] worldStartRoom failed:', err)
          }
        }
      }

      if (!renderer) return

      const moveSelection = (rx: number, ry: number) => {
        const name = formatRoomName(rx, ry)
        setSelectedRoom(name)
        renderer?.setSelectedRoom(name)
        renderer?.centerOn(rx, ry, true)
        props.onSelectedRoomChanged?.(buildRoomInfo(name))
        props.onHoveredRoomChanged?.(buildRoomInfo(name))
      }

      const onKeyDown = (e: KeyboardEvent) => {
        const tag = (e.target as HTMLElement | null)?.tagName ?? ''
        const editable = (e.target as HTMLElement | null)?.isContentEditable ?? false
        if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return

        const cur = selectedRoom()
        const coord = cur ? parseRoomName(cur) : null

        const bounds = worldBounds()
        const inBounds = (nx: number, ny: number) => !bounds || isRoomInWorld(nx, ny, bounds)

        switch (e.key) {
          case 'ArrowLeft':
            e.preventDefault()
            if (coord && inBounds(coord.x - 1, coord.y)) moveSelection(coord.x - 1, coord.y)
            break
          case 'ArrowRight':
            e.preventDefault()
            if (coord && inBounds(coord.x + 1, coord.y)) moveSelection(coord.x + 1, coord.y)
            break
          case 'ArrowUp':
            e.preventDefault()
            if (coord && inBounds(coord.x, coord.y - 1)) moveSelection(coord.x, coord.y - 1)
            break
          case 'ArrowDown':
            e.preventDefault()
            if (coord && inBounds(coord.x, coord.y + 1)) moveSelection(coord.x, coord.y + 1)
            break
          case 'm':
            if (cur && canNavigateTo(cur)) props.onNavigateToRoom(cur)
            break
        }
      }

      window.addEventListener('keydown', onKeyDown)
      keyDownHandler = onKeyDown
    })()
  })

  onCleanup(() => {
    for (const sub of map2Subs.values()) sub.dispose()
    map2Subs.clear()
    renderer?.destroy()
    renderer = null
  })

  // Fetch terrain + stats, manage map2 subscriptions when visible rooms or shard change
  createEffect(() => {
    const c = client()
    const rooms = visibleRooms()
    const shard = props.shard
    if (!c || rooms.length === 0) return

    const me = userInfo()?._id

    c.stores.room.terrainBulk(rooms, shard)
      .then((terrainMap) => {
        for (const [room, terrain] of terrainMap) {
          renderer?.setRoomTerrain(room, terrain)
        }
      })
      .catch((err) => console.error('[map] terrain fetch failed:', err))

    c.http.game.mapStats(rooms, 'owner0', shard ?? undefined)
      .then((res) => {
        latestUsers = res.users
        const newStats: typeof latestStats = {}
        for (const [room, stat] of Object.entries(res.stats)) {
          let mineral: string | undefined
          let density: number | undefined
          for (let i = 0; i < 3; i++) {
            const mineralKey = `minerals${i}` as `minerals${number}`
            const mineralData = stat[mineralKey]
            if (mineralData) {
              mineral = mineralData.type
              density = mineralData.density
              break
            }
          }
          newStats[room] = { own: stat.own, mineral, density }
          const owned = !!(stat.own && stat.own.user !== me)
          renderer?.setRoomOwned(room, owned)
        }
        latestStats = newStats
        // Refresh selected room info now that stats are loaded
        const sel = selectedRoom()
        if (sel && newStats[sel]) {
          props.onSelectedRoomChanged?.(buildRoomInfo(sel))
        }
      })
      .catch((err) => console.error('[map] mapStats failed:', err))

    // Reconcile map2 subscriptions
    const activeKeys = new Set(rooms.map((r) => `${r}/${shard}`))

    for (const [key, sub] of map2Subs) {
      if (!activeKeys.has(key)) {
        sub.dispose()
        map2Subs.delete(key)
      }
    }

    for (const room of rooms) {
      const key = `${room}/${shard}`
      if (!map2Subs.has(key)) {
        map2Subs.set(key, c.stores.room.subscribeMap2(room, shard))
      }
    }
  })

  // Sync room name label visibility when the setting changes
  createEffect(() => {
    renderer?.setShowRoomNames(showMapRoomNames())
  })

  // Draw world bounds border when worldBounds signal updates (renderer already ready at this point)
  createEffect(() => {
    const bounds = worldBounds()
    if (!bounds) renderer?.clearBounds()
    else renderer?.setBounds(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY)
  })

  // Single map2 update listener — re-wired if client reconnects
  createEffect(() => {
    const c = client()
    if (!c) return

    const sub = c.stores.room.on('room:map2update', ({ room, shard, data }) => {
      if (shard !== props.shard) return
      renderer?.setRoomMap2(room, data)
    })

    onCleanup(() => sub.dispose())
  })

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  )
}
