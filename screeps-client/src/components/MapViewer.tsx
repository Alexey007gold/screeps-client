import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { MapRenderer } from '~/renderer/MapRenderer.js'
import { client, userInfo } from '~/stores/clientStore.js'
import { parseRoomName } from '~/utils/roomName.js'
import type { Subscription } from 'screeps-connectivity'

interface MapViewerProps {
  shard: string | null
  onNavigateToRoom: (room: string) => void
}

interface TooltipState {
  room: string
  owner: string | null
  mineral: string | null
  density: number | null
  x: number
  y: number
}

function densityLabel(density: number): string {
  return (['Low', 'Medium', 'High', 'Ultra'] as const)[density - 1] ?? String(density)
}

export function MapViewer(props: MapViewerProps) {
  let canvasRef: HTMLCanvasElement | undefined
  let renderer: MapRenderer | null = null

  const [visibleRooms, setVisibleRooms] = createSignal<string[]>([])
  const [tooltip, setTooltip] = createSignal<TooltipState | null>(null)

  // key = `${room}/${shard}` so shard changes invalidate existing subs
  const map2Subs = new Map<string, Subscription>()

  // Latest mapStats data for tooltip lookups — written async, read in hover handler
  let latestStats: Record<string, { own?: { user: string; level: number }; mineral?: string; density?: number }> = {}
  let latestUsers: Record<string, { username: string }> = {}

  onMount(async () => {
    if (!canvasRef) return

    renderer = new MapRenderer({
      onRoomHover: (room, sx, sy) => {
        if (!room) { setTooltip(null); return }
        const stat = latestStats[room]
        const ownerId = stat?.own?.user
        const owner = ownerId ? (latestUsers[ownerId]?.username ?? ownerId) : null
        setTooltip({
          room,
          owner,
          mineral: stat?.mineral ?? null,
          density: stat?.density ?? null,
          x: sx,
          y: sy,
        })
      },
      onRoomClick: (room) => {
        props.onNavigateToRoom(room)
      },
      onVisibleRoomsChanged: (rooms) => {
        setVisibleRooms(rooms)
      },
    })

    await renderer.init(canvasRef)

    const lastRoom = localStorage.getItem('screeps:room')
    if (lastRoom) {
      const coord = parseRoomName(lastRoom)
      if (coord) renderer.centerOn(coord.x, coord.y)
    }
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
      <Show when={tooltip()}>
        {(t) => (
          <div
            style={{
              position: 'absolute',
              left: `${t().x + 12}px`,
              top: `${t().y + 12}px`,
              padding: '8px 10px',
              background: 'rgba(13, 17, 23, 0.92)',
              border: '1px solid #30363d',
              'border-radius': '4px',
              'font-size': '12px',
              color: '#c9d1d9',
              'pointer-events': 'none',
              'z-index': 10,
              'white-space': 'nowrap',
            }}
          >
            <div style={{ 'font-weight': 600, 'margin-bottom': '4px' }}>{t().room}</div>
            <div>Owner: {t().owner ?? 'None'}</div>
            <Show when={t().mineral}>
              <div>Mineral: {t().mineral}</div>
              <div>Density: {densityLabel(t().density ?? 0)}</div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}
