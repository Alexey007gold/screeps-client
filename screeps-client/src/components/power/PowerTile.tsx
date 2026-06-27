import { Show, For } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { Lock } from 'lucide-solid'
import { type PowerDef, powerEffect, powerMeta } from '~/data/powerCreeps.js'
import { PANEL_RAISED, BORDER, TEXT, MUTED, ACCENT, POWER_RED } from './theme.js'

// A single power in the grid. Read-only on the create preview; on the per-creep
// editor the next level is a clickable pip that stages a +1 upgrade. Saved
// levels show red, staged-but-unsaved levels blue, locked next level a lock.
export function PowerTile(props: {
  def: PowerDef
  /** Saved (server) power level. */
  currentLevel: number
  /** Staged target level (>= currentLevel); defaults to currentLevel. */
  stagedLevel?: number
  editable?: boolean
  /** Whether the next pip can be staged right now (free GPL + creep level ok). */
  canIncrement?: boolean
  /** Shown when the next level is gated by creep level, e.g. "Lvl 7". */
  lockLevel?: number
  onIncrement?: () => void
}) {
  const staged = () => props.stagedLevel ?? props.currentLevel
  const displayLevel = () => Math.max(1, staged())
  const isPreview = () => staged() === 0
  const nextPip = () => staged() + 1

  const pipState = (i: number): 'saved' | 'staged' | 'next' | 'locked' | 'empty' => {
    if (i <= props.currentLevel) return 'saved'
    if (i <= staged()) return 'staged'
    if (i === nextPip() && props.editable) return props.canIncrement ? 'next' : 'locked'
    return 'empty'
  }

  return (
    <div style={{ background: PANEL_RAISED, border: `1px solid ${BORDER}`, 'border-radius': '8px', padding: '12px 14px', display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
      <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
        <Dynamic component={props.def.icon} size={16} color={staged() > 0 ? POWER_RED : MUTED} />
        <span style={{ color: TEXT, 'font-size': '12px', 'font-weight': 600, 'letter-spacing': '0.02em', flex: 1, 'min-width': 0, 'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis' }}>
          {props.def.name}
        </span>
        <span style={{ color: staged() > 0 ? TEXT : MUTED, 'font-size': '11px' }}>Lv {staged()}</span>
      </div>

      {/* Level pips */}
      <div style={{ display: 'flex', 'align-items': 'center', gap: '5px' }}>
        <For each={[1, 2, 3, 4, 5]}>
          {(i) => {
            const st = () => pipState(i)
            const clickable = () => st() === 'next'
            return (
              <button
                disabled={!clickable()}
                onClick={() => clickable() && props.onIncrement?.()}
                title={
                  st() === 'locked' && props.lockLevel != null
                    ? `Unlocks at creep Lvl ${props.lockLevel}`
                    : clickable()
                      ? `Upgrade to Lv ${i}`
                      : undefined
                }
                style={{
                  width: '14px', height: '14px', 'border-radius': '50%', padding: 0, 'flex-shrink': 0,
                  cursor: clickable() ? 'pointer' : 'default',
                  display: 'flex', 'align-items': 'center', 'justify-content': 'center',
                  background: st() === 'saved' ? POWER_RED : st() === 'staged' ? ACCENT : 'transparent',
                  border:
                    st() === 'next' ? `1px solid ${ACCENT}`
                    : st() === 'locked' ? `1px dashed ${BORDER}`
                    : st() === 'saved' || st() === 'staged' ? 'none'
                    : `1px solid ${BORDER}`,
                }}
              >
                <Show when={st() === 'locked'}>
                  <Lock size={8} color={MUTED} />
                </Show>
              </button>
            )
          }}
        </For>
        <Show when={props.editable && nextPip() <= 5 && !props.canIncrement && props.lockLevel != null}>
          <span style={{ color: MUTED, 'font-size': '10px', 'margin-left': '4px' }}>unlocks at Lvl {props.lockLevel}</span>
        </Show>
      </div>

      <div style={{ color: isPreview() ? MUTED : TEXT, 'font-size': '11px', 'line-height': '1.4' }}>
        {powerEffect(props.def, displayLevel())}
      </div>
      <div style={{ color: MUTED, 'font-size': '10px' }}>{powerMeta(props.def, displayLevel())}</div>
    </div>
  )
}
