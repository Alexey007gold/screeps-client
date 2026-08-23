import { For, Show } from 'solid-js'

export const BODY_PART_CSS: Record<string, string> = {
  tough:         '#4c4c4c',
  move:          '#a9b7c6',
  work:          '#ffe56d',
  carry:         '#777777',
  attack:        '#f93842',
  ranged_attack: '#5d80b2',
  heal:          '#65fd62',
  claim:         '#b99cfb',
}

export function BodyParts(props: { body: Array<{ type: string; hits?: number }> }) {
  const bodyGroups = () => {
    const counts = new Map<string, number>()
    for (const part of props.body) counts.set(part.type, (counts.get(part.type) ?? 0) + 1)
    return [...counts.entries()].map(([type, count]) => ({ type, count }))
  }

  return (
    <Show when={props.body.length > 0}>
      <div style={{ background: '#21262d', 'border-top': '1px solid #30363d', 'font-size': '10px' }}>
        <div style={{ padding: '4px 8px', background: '#161b22', color: '#8b949e', 'font-weight': 600 }}>
          Body ({props.body.length})
        </div>
        <div style={{
          display: 'flex',
          'flex-wrap': 'wrap',
          gap: '3px',
          padding: '8px',
          background: '#0d1117',
        }}>
          <For each={props.body}>
            {(part) => (
              <div
                title={part.type.replace('_', ' ')}
                style={{
                  width: '11px',
                  height: '11px',
                  'border-radius': '50%',
                  background: BODY_PART_CSS[part.type] ?? '#484f58',
                  opacity: part.hits === 0 ? 0.25 : 1,
                  'flex-shrink': 0,
                }}
              />
            )}
          </For>
        </div>
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
