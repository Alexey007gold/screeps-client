import { createResource, createSignal, For, Show } from 'solid-js'
import { ChevronLeft } from 'lucide-solid'
import type { ApiRoomOverviewResponse } from 'screeps-connectivity'
import { OverlayPage } from '~/components/OverlayPage.js'
import { client } from '~/stores/clientStore.js'
import { goToGame, goToRoom, roomOverviewTarget } from '~/stores/routeStore.js'
import { PlayerBadge } from '~/components/PlayerBadge.js'
import { UserLink } from '~/components/UserLink.js'
import { RoomPreviewTile } from '~/components/RoomPreviewTile.js'
import { StatTileRow, totalsFromStats } from '~/components/AccountStatTiles.js'
import { formatStat } from '~/utils/formatStat.js'

// Read-only per-room stats page (/room-overview/<shard>/<room>): owner, the same
// seven stat tiles as the account Overview summed over the selected interval, and
// a per-bucket history graph — fed by GET /api/game/room-overview.
const PANEL = '#161b22'
const BORDER = '#30363d'
const TEXT = '#c9d1d9'
const MUTED = '#8b949e'
const GOLD = '#d9b54a'

// Same stat-window dropdown as the account pages: 8 → 1 hour, 180 → 24 hours,
// 1440 → 7 days. The interval both sums the tiles and sizes the graph buckets.
const STAT_INTERVALS = [
  { value: 8, label: '1 hour', unit: 'm' },
  { value: 180, label: '24 hours', unit: 'h' },
  { value: 1440, label: '7 days', unit: 'd' },
] as const

// Graph rows, in vanilla order/labels. Power processed is omitted (it has no
// per-room time series), matching the official room-overview graph.
const GRAPH_METRICS = [
  { key: 'energyHarvested', label: 'Energy harvested', color: '#ffe56d' },
  { key: 'energyConstruction', label: 'Construction points', color: '#eeeeee' },
  { key: 'energyControl', label: 'Control points', color: '#A7FFEB' },
  { key: 'energyCreeps', label: 'Energy spent on creeps', color: '#eeeeee' },
  { key: 'creepsProduced', label: 'Creeps produced', color: '#65fd62' },
  { key: 'creepsLost', label: 'Creeps lost', color: '#f96e76' },
] as const

const unitFor = (interval: number) => STAT_INTERVALS.find((i) => i.value === interval)?.unit ?? 'd'

// Relative age label for bucket i of n (0 = oldest … n-1 = now).
function bucketLabel(i: number, n: number, unit: string): string {
  const age = n - 1 - i
  return age === 0 ? '0' : `-${age}${unit}`
}

// One graph row: label + a strip of dots, one per bucket, opacity scaled by the
// bucket's share of the row max so the busiest ticks read brightest.
function GraphRow(props: { label: string; color: string; buckets: Array<{ value: number }>; unit: string }) {
  const max = () => props.buckets.reduce((m, b) => Math.max(m, b.value ?? 0), 0)
  const n = () => props.buckets.length
  return (
    <div style={{ display: 'flex', 'align-items': 'center', 'border-top': `1px solid ${BORDER}`, padding: '10px 0' }}>
      <div style={{ width: '190px', 'flex-shrink': '0', color: TEXT, 'font-size': '13px' }}>{props.label}</div>
      <div style={{ display: 'flex', flex: 1, 'min-width': '0', 'align-items': 'center' }}>
        <For each={props.buckets}>
          {(b, i) => {
            const m = max()
            const opacity = m > 0 && b.value > 0 ? Math.max(0.18, b.value / m) : 0.07
            const size = b.value > 0 ? 7 : 3
            return (
              <div
                title={`${bucketLabel(i(), n(), props.unit)}: ${formatStat(b.value)}`}
                style={{ flex: 1, 'min-width': '0', display: 'flex', 'justify-content': 'center', 'align-items': 'center', height: '16px' }}
              >
                <div style={{ width: `${size}px`, height: `${size}px`, 'border-radius': '50%', background: props.color, opacity: String(opacity) }} />
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}

export function RoomOverview() {
  const [interval, setInterval] = createSignal<number>(1440)

  // Room-overview payload for the current target + interval. Null while no room is
  // targeted; errors (e.g. servers without the endpoint) resolve to null.
  const [data] = createResource(
    () => {
      const t = roomOverviewTarget()
      return t ? ({ room: t.room, shard: t.shard, interval: interval() } as const) : null
    },
    async ({ room, shard, interval }): Promise<ApiRoomOverviewResponse | null> => {
      const c = client()
      if (!c) return null
      try {
        return await c.http.game.roomOverview(room, interval, shard)
      } catch {
        return null
      }
    },
  )

  // Resolve the owner's user id (the overview payload carries only username/badge)
  // so their structures render own-green in the header minimap.
  const [ownerId] = createResource(
    () => data()?.owner?.username ?? null,
    async (username) => {
      const c = client()
      if (!c) return undefined
      try {
        return (await c.http.user.find({ username }))?.user?._id
      } catch {
        return undefined
      }
    },
  )

  const room = () => roomOverviewTarget()?.room ?? ''
  const shard = () => roomOverviewTarget()?.shard ?? null
  const totals = () => totalsFromStats({ ok: 1, stats: data()?.stats })
  const bucketsFor = (key: string) => data()?.stats?.[key] ?? []

  return (
    <OverlayPage>
      {/* Header card — back, room title + owner, room minimap thumbnail */}
      <div style={{ display: 'flex', 'align-items': 'center', gap: '18px', background: PANEL, border: `1px solid ${BORDER}`, 'border-radius': '8px', padding: '16px 20px', 'margin-bottom': '20px' }}>
        <button
          onClick={goToGame}
          title="Back"
          style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'center', width: '38px', height: '38px', 'flex-shrink': '0', 'border-radius': '50%', border: `1px solid ${BORDER}`, background: '#21262d', color: TEXT, cursor: 'pointer' }}
        >
          <ChevronLeft size={20} />
        </button>
        <div style={{ flex: 1, 'min-width': '0' }}>
          <h1 style={{ margin: 0, 'font-size': '26px', 'font-weight': 600, color: GOLD }}>
            Room {room()}
            <Show when={shard()}>
              <span style={{ color: MUTED, 'font-size': '15px', 'font-weight': 400, 'margin-left': '10px' }}>{shard()}</span>
            </Show>
          </h1>
          <Show when={data()?.owner} fallback={<div style={{ color: MUTED, 'font-size': '14px', 'margin-top': '6px' }}>Unclaimed room</div>}>
            {(owner) => (
              <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'margin-top': '6px', color: MUTED, 'font-size': '14px' }}>
                <span>Owner:</span>
                <PlayerBadge badge={owner().badge} size={18} />
                <UserLink username={owner().username} color="#58a6ff" />
              </div>
            )}
          </Show>
        </div>
        <RoomPreviewTile room={room()} shard={shard()} ownerId={ownerId()} showLabel={false} onClick={() => goToRoom(room(), shard())} />
      </div>

      {/* Stat tiles — summed over the selected interval */}
      <StatTileRow totals={totals()} />

      {/* History graph */}
      <div style={{ background: PANEL, border: `1px solid ${BORDER}`, 'border-radius': '8px', padding: '16px 20px', 'margin-top': '20px' }}>
        <div style={{ display: 'flex', 'align-items': 'center', 'margin-bottom': '4px' }}>
          <h2 style={{ margin: 0, 'font-size': '18px', 'font-weight': 600, color: GOLD }}>Graph</h2>
          <div style={{ flex: 1 }} />
          <select
            value={interval()}
            onChange={(e) => setInterval(Number(e.currentTarget.value))}
            style={{ padding: '4px 8px', 'border-radius': '4px', border: `1px solid ${BORDER}`, background: PANEL, color: MUTED, 'font-size': '12px', cursor: 'pointer' }}
          >
            <For each={STAT_INTERVALS}>{(opt) => <option value={opt.value}>{opt.label}</option>}</For>
          </select>
        </div>

        <Show
          when={!data.loading}
          fallback={<div style={{ color: MUTED, 'text-align': 'center', padding: '40px' }}>Loading…</div>}
        >
          <For each={GRAPH_METRICS}>
            {(m) => <GraphRow label={m.label} color={m.color} buckets={bucketsFor(m.key)} unit={unitFor(interval())} />}
          </For>
        </Show>
      </div>
    </OverlayPage>
  )
}
