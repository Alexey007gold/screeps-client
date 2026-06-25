import { createResource, Show } from 'solid-js'
import { ChevronLeft } from 'lucide-solid'
import { client } from '~/stores/clientStore.js'
import { profileUsername, goToGame } from '~/stores/routeStore.js'
import { RankRing, GCL_RING, GCL_TEXT } from '~/components/RankRing.js'
import { PlayerBadge } from '~/components/PlayerBadge.js'
import { gclProgress, type LevelProgress } from '~/utils/levels.js'

// Public identity card for any player, keyed by username. The public lookup
// (user/find) only returns { username, badge, gcl } — power, credits and
// lifetime stats are self-only (those live on the Overview page), so the
// public profile is deliberately minimal: badge + name + GCL.
const BG = '#0d1117'
const PANEL = '#161b22'
const BORDER = '#30363d'
const TEXT = '#c9d1d9'
const MUTED = '#8b949e'

export function Profile() {
  const [user] = createResource(
    () => profileUsername(),
    async (username) => {
      const c = client()
      if (!c) return null
      try {
        const res = await c.http.user.find({ username })
        return res.user ?? null
      } catch {
        // Unknown username / lookup failure → render the not-found state.
        return null
      }
    },
  )

  const gclProg = (): LevelProgress => gclProgress(user()?.gcl ?? 0)
  const fraction = (p: LevelProgress) => (p.total > 0 ? p.current / p.total : 0)
  const tooltip = (p: LevelProgress) => `Next level: ${Math.floor(p.current).toLocaleString()} / ${Math.floor(p.total).toLocaleString()}`

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'auto', background: BG, color: TEXT }}>
      <div style={{ 'max-width': '900px', margin: '0 auto', padding: '24px 16px 40px' }}>
        {/* Header */}
        <div style={{ display: 'flex', 'align-items': 'center', padding: '0 0 14px', 'border-bottom': `1px solid ${BORDER}`, 'margin-bottom': '24px' }}>
          <h1 style={{ margin: 0, flex: 1, 'font-size': '22px', 'font-weight': 600, color: TEXT }}>Profile</h1>
          <button
            onClick={goToGame}
            title="Back to the world"
            style={{ display: 'flex', 'align-items': 'center', gap: '4px', padding: '7px 12px', 'border-radius': '4px', border: `1px solid ${BORDER}`, background: '#21262d', color: TEXT, cursor: 'pointer' }}
          >
            <ChevronLeft size={16} /> World
          </button>
        </div>

        <Show when={!user.loading} fallback={<div style={{ color: MUTED, 'text-align': 'center', padding: '40px' }}>Loading…</div>}>
          <Show when={user()} fallback={<div style={{ color: MUTED, 'text-align': 'center', 'font-size': '18px', padding: '40px' }}>User not found</div>}>
            {(u) => (
              <div style={{ display: 'flex', 'align-items': 'center', gap: '20px', background: PANEL, border: `1px solid ${BORDER}`, 'border-radius': '6px', padding: '20px' }}>
                <PlayerBadge badge={u().badge} size={64} />
                <div style={{ flex: 1 }}>
                  <div style={{ 'font-size': '22px', 'font-weight': 600, 'margin-bottom': '4px' }}>{u().username}</div>
                  <div style={{ color: MUTED, 'font-size': '13px' }}>Global Control Level {gclProg().level}</div>
                </div>
                <RankRing value={gclProg().level} label="GCL" ring={GCL_RING} text={GCL_TEXT} fraction={fraction(gclProg())} tooltip={tooltip(gclProg())} />
              </div>
            )}
          </Show>
        </Show>
      </div>
    </div>
  )
}
