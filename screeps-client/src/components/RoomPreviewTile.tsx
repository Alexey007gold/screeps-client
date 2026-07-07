import { onCleanup, onMount, Show } from 'solid-js'
import { BarChart3 } from 'lucide-solid'
import type { RoomMap2Data } from 'screeps-connectivity'
import { TerrainType } from 'screeps-connectivity'
import { client, userInfo } from '~/stores/clientStore.js'
import {
  MINIMAP_TILE, MINIMAP_ROOM, MINIMAP_PLAIN, MINIMAP_WALL, MINIMAP_SWAMP,
  MINIMAP_ROAD, MINIMAP_WALLS_OWN, MINIMAP_USER_OWN, MINIMAP_USER_FOREIGN,
  MAP2_DOT_FEATURES, MAP2_FIXED_KEYS, toCss,
} from '~/renderer/minimap.js'

// App chrome (matches the Overview / GitHub-dark palette).
const PANEL = '#161b22'
const BORDER = '#30363d'
const TEXT = '#c9d1d9'

const T = MINIMAP_TILE

type Terrain = { raw: Uint8Array } | null

// map2 cell features drawn as filled rects (roads, walls), inset to leave a hairline gap.
function fillRects(ctx: CanvasRenderingContext2D, positions: [number, number][], color: number, inset: number): void {
  if (!positions.length) return
  ctx.fillStyle = toCss(color)
  const s = T - inset * 2
  for (const [x, y] of positions) ctx.fillRect(x * T + inset, y * T + inset, s, s)
}

// map2 point features drawn as a single batched path of dots.
function fillDots(ctx: CanvasRenderingContext2D, positions: [number, number][], color: number, r: number): void {
  if (!positions.length) return
  ctx.fillStyle = toCss(color)
  ctx.beginPath()
  for (const [x, y] of positions) {
    const cx = (x + 0.5) * T
    const cy = (y + 0.5) * T
    ctx.moveTo(cx + r, cy)
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
  }
  ctx.fill()
}

// One ~150px minimap of an owned room: baked terrain + map2 object dots, the
// same per-room render as the world map but on a plain 2D canvas. Consumes the
// shared minimap.ts palette so it stays pixel-identical to MapRenderer.
// `ownerId` marks which user's objects render in own-green vs foreign-red;
// defaults to the logged-in user (Overview), set to the profiled user on a public
// profile so their structures show green.
// `onOverview`, when set, adds a small chart button in the footer that opens the
// per-room stats page. `showLabel` (default true) can be turned off for a bare
// thumbnail (e.g. the Room Overview header).
export function RoomPreviewTile(props: {
  room: string
  shard: string | null
  ownerId?: string
  onClick?: () => void
  onOverview?: () => void
  showLabel?: boolean
}) {
  let canvas: HTMLCanvasElement | undefined
  let terrain: Terrain = null
  let map2: Partial<RoomMap2Data> | null = null
  // The user whose objects render own-green; captured at mount (stable per tile).
  let ownerId: string | undefined

  const draw = (): void => {
    const ctx = canvas?.getContext('2d')
    if (!ctx) return
    ctx.setTransform(2, 0, 0, 2, 0, 0) // retina: draw in logical px, back by 2× device px

    // Plain fill doubles as the clear for redraws.
    ctx.fillStyle = toCss(MINIMAP_PLAIN)
    ctx.fillRect(0, 0, MINIMAP_ROOM, MINIMAP_ROOM)

    if (terrain) {
      const raw = terrain.raw
      ctx.fillStyle = toCss(MINIMAP_WALL)
      for (let i = 0; i < 2500; i++) if (raw[i] === TerrainType.Wall) ctx.fillRect((i % 50) * T, Math.floor(i / 50) * T, T, T)
      ctx.fillStyle = toCss(MINIMAP_SWAMP)
      for (let i = 0; i < 2500; i++) if (raw[i] === TerrainType.Swamp) ctx.fillRect((i % 50) * T, Math.floor(i / 50) * T, T, T)
    }

    const data = map2
    if (data) {
      fillRects(ctx, data.r ?? [], MINIMAP_ROAD, 0)
      fillRects(ctx, data.w ?? [], MINIMAP_WALLS_OWN, 0.5) // overview rooms are own
      for (const feat of MAP2_DOT_FEATURES) fillDots(ctx, data[feat.key] ?? [], feat.color, feat.radius)
      // Remaining keys are userIds → object dots, green for self, muted red for others.
      const rec = data as Record<string, [number, number][]>
      const uid = ownerId ?? userInfo()?._id
      for (const key in rec) {
        if (MAP2_FIXED_KEYS.has(key)) continue
        const positions = rec[key]
        if (!Array.isArray(positions) || positions.length === 0) continue
        fillDots(ctx, positions, key === uid ? MINIMAP_USER_OWN : MINIMAP_USER_FOREIGN, 1.2)
      }
    }
  }

  onMount(() => {
    const c = client()
    if (!c) return
    ownerId = props.ownerId
    c.stores.room.terrain(props.room, props.shard).then((t) => { terrain = t; draw() }).catch(() => {})
    const sub = c.stores.map.subscribeMap2(props.room, props.shard)
    // Synchronous first paint from the in-memory cache. subscribeMap2 also schedules
    // a warm-start 'room:map2update' (cache) a microtask later, so this only avoids a
    // one-frame empty flash; the listener below repaints with the same/fresh data.
    const seed = c.stores.map.map2data(props.room, props.shard)
    if (seed) { map2 = seed; draw() }
    // Long-lived listener: reads live props at invocation time to filter for this
    // tile's room/shard. Reactivity lint suppressed — re-binding would drop events.
    // eslint-disable-next-line solid/reactivity
    const lsn = c.stores.map.on('room:map2update', ({ room, shard, data }) => {
      if (room !== props.room || (shard ?? null) !== (props.shard ?? null)) return
      map2 = data
      draw()
    })
    onCleanup(() => { sub.dispose(); lsn.dispose() })
  })

  const activate = () => props.onClick?.()

  // A <div> rather than a <button> so the footer's overview action can be a real
  // nested <button> (buttons can't nest); role/tabindex/keydown keep it operable.
  return (
    <div
      role="button"
      tabindex={0}
      onClick={activate}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() } }}
      title={props.room + (props.shard ? ` · ${props.shard}` : '')}
      style={{ padding: '0', border: `1px solid ${BORDER}`, 'border-radius': '6px', overflow: 'hidden', background: PANEL, cursor: 'pointer', 'line-height': '0' }}
    >
      <canvas
        ref={(el) => canvas = el}
        width={MINIMAP_ROOM * 2}
        height={MINIMAP_ROOM * 2}
        style={{ width: `${MINIMAP_ROOM}px`, height: `${MINIMAP_ROOM}px`, display: 'block' }}
      />
      <Show when={props.showLabel !== false}>
        <div style={{ position: 'relative', padding: '4px 0', 'text-align': 'center', 'font-size': '12px', 'font-family': 'monospace', color: TEXT, 'line-height': '1.2', 'border-top': `1px solid ${BORDER}` }}>
          {props.room}
          <Show when={props.onOverview}>
            <button
              onClick={(e) => { e.stopPropagation(); props.onOverview?.() }}
              title={`Room overview — ${props.room}`}
              style={{
                position: 'absolute', top: '50%', right: '4px', transform: 'translateY(-50%)',
                display: 'flex', 'align-items': 'center', padding: '2px', 'border-radius': '3px',
                border: `1px solid ${BORDER}`, background: '#21262d', color: '#8b949e', cursor: 'pointer', 'line-height': '0',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#58a6ff')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#8b949e')}
            >
              <BarChart3 size={13} />
            </button>
          </Show>
        </div>
      </Show>
    </div>
  )
}
