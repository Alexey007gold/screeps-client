import { createEffect, createSignal, onCleanup, onMount, For, Show } from 'solid-js'
import { ChevronLeft } from 'lucide-solid'
import type { ApiUserOverviewTotals, ApiUserRoomsResponse } from 'screeps-connectivity'
import { client, userInfo } from '~/stores/clientStore.js'
import { goToGame, goToRoom } from '~/stores/routeStore.js'
import { RankRing, GCL_RING, GCL_TEXT, GPL_RING, GPL_TEXT } from '~/components/RankRing.js'
import { PlayerBadge } from '~/components/PlayerBadge.js'
import { RoomPreviewTile } from '~/components/RoomPreviewTile.js'
import { gclProgress, gplProgress, type LevelProgress } from '~/utils/levels.js'
import { formatStat } from '~/utils/formatStat.js'

// Vanilla refetches the overview (and re-reads the account record) on a 60s
// timer rather than via a socket subscription; mirror that cadence.
const REFRESH_MS = 60_000
// Stat interval in tick-buckets; 8 ≈ the vanilla "1 hour" default. statName only
// drives the (deferred) per-room punch-card, so any valid value works here.
const STAT_INTERVAL = 8

// App chrome (matches the Dashboard / GitHub-dark palette used across the site).
const BG = '#0d1117'
const PANEL = '#161b22'
const BORDER = '#30363d'
const TEXT = '#c9d1d9'
const MUTED = '#8b949e'

const STAT_TILES: Array<{ key: keyof ApiUserOverviewTotals; l1: string; l2: string; color: string }> = [
  { key: 'energyControl', l1: 'Control', l2: 'points', color: '#A7FFEB' },
  { key: 'energyHarvested', l1: 'Energy', l2: 'harvested', color: '#ffe56d' },
  { key: 'energyConstruction', l1: 'Energy', l2: 'on construct', color: '#eeeeee' },
  { key: 'energyCreeps', l1: 'Energy', l2: 'on creeps', color: '#eeeeee' },
  { key: 'creepsProduced', l1: 'Creeps', l2: 'produced', color: '#65fd62' },
  { key: 'creepsLost', l1: 'Creeps', l2: 'lost', color: '#f96e76' },
  { key: 'powerProcessed', l1: 'Power', l2: 'processed', color: '#E04040' },
]

function StatTile(props: { l1: string; l2: string; color: string; value: number | undefined }) {
  return (
    <div style={{ flex: 1, 'min-width': '0', background: PANEL, border: `1px solid ${BORDER}`, 'border-radius': '6px', padding: '14px 8px 12px', 'text-align': 'center' }}>
      <div style={{ color: MUTED, 'font-size': '11px', 'text-transform': 'uppercase', 'line-height': '1.3' }}>
        {props.l1}<br />{props.l2}
      </div>
      <div style={{ color: props.color, 'font-size': '28px', 'font-weight': 300, 'margin-top': '8px' }}>{formatStat(props.value)}</div>
    </div>
  )
}

interface OwnedRoom {
  room: string
  shard: string | null
}

// The rooms endpoint shape varies by server: multishard keys rooms by shard,
// single-shard may return a flat list. Normalize both to {room, shard}.
function extractOwnedRooms(res: ApiUserRoomsResponse): OwnedRoom[] {
  if (res.shards) {
    return Object.entries(res.shards).flatMap(([shard, list]) =>
      (list ?? []).map((room) => ({ room, shard })))
  }
  return (res.rooms ?? []).map((room) => ({ room, shard: null }))
}

export function Overview() {
  const [totals, setTotals] = createSignal<ApiUserOverviewTotals | null>(null)
  const [rooms, setRooms] = createSignal<OwnedRoom[]>([])

  // Fetch the owned-room list once the user id is available. Read reactively
  // (not once in onMount) so this doesn't depend on auth resolving before mount;
  // the guard makes it fire exactly once, retrying only on error.
  let roomsRequested = false
  createEffect(() => {
    const c = client()
    const uid = userInfo()?._id
    if (!c || !uid || roomsRequested) return
    roomsRequested = true
    void c.http.user.rooms(uid)
      .then((res) => setRooms(extractOwnedRooms(res)))
      .catch(() => { roomsRequested = false })
  })

  onMount(() => {
    const c = client()
    if (!c) return
    let timer: ReturnType<typeof setInterval> | null = null

    const fetchOverview = () =>
      c.http.user.overview(STAT_INTERVAL, 'energyHarvested').then((res) => setTotals(res.totals ?? null))

    // Only start the poll after the first fetch succeeds: on servers that don't
    // implement /api/user/overview the request errors (and surfaces a toast), so
    // we render zeros and avoid repeating it — and the toast — every minute.
    void fetchOverview()
      .then(() => {
        timer = setInterval(() => {
          void c.stores.user.refreshMe().catch(() => {})
          void fetchOverview().catch(() => {})
        }, REFRESH_MS)
      })
      .catch(() => {})

    onCleanup(() => {
      if (timer) clearInterval(timer)
    })
  })

  const gclProg = (): LevelProgress => gclProgress(userInfo()?.gcl ?? 0)
  const gplProg = (): LevelProgress => gplProgress(userInfo()?.power ?? 0)
  const fraction = (p: LevelProgress) => (p.total > 0 ? p.current / p.total : 0)
  const tooltip = (p: LevelProgress) => `Next level: ${Math.floor(p.current).toLocaleString()} / ${Math.floor(p.total).toLocaleString()}`

  const cardStyle = {
    flex: 1,
    display: 'flex',
    'align-items': 'center',
    gap: '16px',
    background: PANEL,
    border: `1px solid ${BORDER}`,
    'border-radius': '6px',
    padding: '16px',
  }

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'auto', background: BG, color: TEXT }}>
      <div style={{ 'max-width': '900px', margin: '0 auto', padding: '24px 16px 40px' }}>
        {/* Header — this is the player's own account page, so it carries their identity. */}
        <div style={{ display: 'flex', 'align-items': 'center', gap: '10px', padding: '0 0 14px', 'border-bottom': `1px solid ${BORDER}`, 'margin-bottom': '24px' }}>
          <PlayerBadge badge={userInfo()?.badge} size={28} />
          <h1 style={{ margin: 0, 'font-size': '22px', 'font-weight': 600, color: TEXT }}>Overview</h1>
          <span style={{ color: MUTED, 'font-size': '14px' }}>{userInfo()?.username}</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={goToGame}
            title="Back to the world"
            style={{ display: 'flex', 'align-items': 'center', gap: '4px', padding: '7px 12px', 'border-radius': '4px', border: `1px solid ${BORDER}`, background: '#21262d', color: TEXT, cursor: 'pointer' }}
          >
            <ChevronLeft size={16} /> World
          </button>
        </div>

        {/* GCL / GPL cards */}
        <div style={{ display: 'flex', gap: '16px', 'margin-bottom': '16px' }}>
          <div style={cardStyle}>
            <RankRing value={gclProg().level} label="GCL" ring={GCL_RING} text={GCL_TEXT} fraction={fraction(gclProg())} tooltip={tooltip(gclProg())} />
            <div>
              <div style={{ 'font-size': '16px', 'font-weight': 600, color: TEXT, 'margin-bottom': '6px' }}>Global Control Level</div>
              {/* Vanilla labels this "Rooms" but renders the GCL level number; mirror it. */}
              <div style={{ color: MUTED, 'font-size': '13px' }}>
                <span>Rooms: <strong style={{ color: TEXT }}>{gclProg().level}</strong></span>
                <span style={{ 'margin-left': '14px' }}>CPU: <strong style={{ color: TEXT }}>{userInfo()?.cpu ?? '—'}</strong></span>
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <RankRing value={gplProg().level} label="GPL" ring={GPL_RING} text={GPL_TEXT} fraction={fraction(gplProg())} tooltip={tooltip(gplProg())} />
            <div>
              <div style={{ 'font-size': '16px', 'font-weight': 600, color: TEXT, 'margin-bottom': '8px' }}>Global Power Level</div>
              <button
                disabled
                title="Not available yet"
                style={{ padding: '5px 10px', 'border-radius': '4px', border: `1px solid ${BORDER}`, background: '#21262d', color: MUTED, 'font-size': '12px', cursor: 'default', opacity: 0.7 }}
              >
                Manage Power Creeps
              </button>
            </div>
          </div>
        </div>

        {/* Lifetime stat tiles */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <For each={STAT_TILES}>
            {(t) => <StatTile l1={t.l1} l2={t.l2} color={t.color} value={totals()?.[t.key]} />}
          </For>
        </div>

        {/* Owned-room minimaps */}
        <Show when={rooms().length}>
          <div style={{ 'margin-top': '24px' }}>
            <div style={{ color: MUTED, 'font-size': '11px', 'text-transform': 'uppercase', 'margin-bottom': '12px' }}>Rooms</div>
            <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '16px' }}>
              <For each={rooms()}>
                {(r) => <RoomPreviewTile room={r.room} shard={r.shard} onClick={() => goToRoom(r.room, r.shard)} />}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
