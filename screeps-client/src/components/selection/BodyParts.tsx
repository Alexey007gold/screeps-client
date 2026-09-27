import { For, Index, Show, createSignal } from 'solid-js'
import { Portal } from 'solid-js/web'

export const BODY_PART_CSS: Record<string, string> = {
  tough:         '#ffffff',
  move:          '#a9b7c6',
  work:          '#ffe56d',
  carry:         '#777777',
  attack:        '#f93842',
  ranged_attack: '#5d80b2',
  heal:          '#65fd62',
  claim:         '#b99cfb',
}

export type BodyPart = { type: string; hits?: number; boost?: string | null }

export function BodyParts(props: { body: BodyPart[] }) {
  const bodyGroups = () => {
    const counts = new Map<string, number>()
    for (const part of props.body) counts.set(part.type, (counts.get(part.type) ?? 0) + 1)
    return [...counts.entries()].map(([type, count]) => ({ type, count }))
  }

  const [hovered, setHovered] = createSignal<{ index: number; x: number; y: number } | null>(null)
  const hoveredLabel = () => {
    const h = hovered()
    const part = h ? props.body[h.index] : undefined
    if (!part) return null
    const name = part.type.replace('_', ' ')
    return part.boost ? `${name} (${part.boost})` : name
  }

  return (
    <Show when={props.body.length > 0}>
      <div style={{ background: '#21262d', 'border-top': '1px solid #30363d', 'font-size': '10px' }}>
        <div style={{ padding: '4px 8px', background: '#161b22', color: '#8b949e', 'font-weight': 600 }}>
          Body ({props.body.length})
        </div>
        <div
          onMouseLeave={() => setHovered(null)}
          style={{
            display: 'flex',
            'flex-wrap': 'wrap',
            gap: '5px',
            padding: '8px',
            background: '#0d1117',
          }}
        >
          <Index each={props.body}>
            {(part, index) => (
              <div
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setHovered({ index, x: rect.left + rect.width / 2, y: rect.top })
                }}
                onMouseLeave={() => setHovered(null)}
                style={{
                  width: '11px',
                  height: '11px',
                  'border-radius': '50%',
                  background: BODY_PART_CSS[part().type] ?? '#484f58',
                  opacity: part().hits === 0 ? 0.25 : 1,
                  'box-shadow': part().boost ? '0 0 0 2px #ffffff' : undefined,
                  'flex-shrink': 0,
                }}
              />
            )}
          </Index>
        </div>
        <Show when={hoveredLabel()}>
          {(label) => (
            <Portal>
              <div style={{
                position: 'fixed',
                left: `${hovered()!.x}px`,
                top: `${hovered()!.y - 6}px`,
                transform: 'translate(-50%, -100%)',
                padding: '2px 6px',
                background: '#161b22',
                border: '1px solid #30363d',
                'border-radius': '4px',
                color: '#c9d1d9',
                'font-size': '10px',
                'white-space': 'nowrap',
                'pointer-events': 'none',
                'z-index': 1000,
              }}>
                {label()}
              </div>
            </Portal>
          )}
        </Show>
        <div style={{
          display: 'flex',
          'flex-wrap': 'wrap',
          gap: '2px 10px',
          padding: '0 8px 8px',
          background: '#0d1117',
        }}>
          <For each={bodyGroups()}>
            {({ type, count }) => (
              <span style={{ 'font-size': '10px', 'font-variant-numeric': 'tabular-nums' }}>
                <span style={{ color: '#8b949e' }}>{count}×</span>
                <span style={{ color: BODY_PART_CSS[type] ?? '#484f58' }}>{type.replace('_', ' ').toUpperCase()}</span>
              </span>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
