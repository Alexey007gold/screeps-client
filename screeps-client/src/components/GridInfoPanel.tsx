import { For, Show } from 'solid-js'
import { serverVersion, isPrivateServer } from '~/stores/clientStore.js'

interface GridInfoPanelProps {
  zoom?: number | null
  fullDetailCount?: number | null
  shard?: string | null
  onShardChange?: (shard: string) => void
}

// Sibling to MapInfoPanel, but deliberately smaller — v1 of the grid view is
// view + inspect only, so there are no overlay-mode / decoration toggles to
// show here yet (those live on individual full-detail rooms, not the grid).
export function GridInfoPanel(props: GridInfoPanelProps) {
  const shards = () => serverVersion()?.serverData?.shards?.filter((s): s is string => s !== null) ?? []
  const multiShard = () => isPrivateServer() === false && shards().length > 1

  return (
    <div style={{ padding: '8px', 'border-bottom': '1px solid #30363d', 'flex-shrink': 0 }}>
      <Show when={multiShard()}>
        <div style={{ 'margin-bottom': '8px' }}>
          <select
            value={props.shard ?? ''}
            onChange={(e) => props.onShardChange?.(e.currentTarget.value)}
            style={{
              width: '100%',
              padding: '5px 8px',
              background: '#161b22',
              border: '1px solid #30363d',
              'border-radius': '6px',
              color: '#c9d1d9',
              'font-size': '12px',
              cursor: 'pointer',
            }}
          >
            <For each={shards()}>
              {(s) => <option value={s}>{s}</option>}
            </For>
          </select>
        </div>
      </Show>
      <div
        style={{
          padding: '4px 8px',
          background: '#161b22',
          'border-radius': '6px',
          border: '1px solid #30363d',
        }}
      >
        <div
          style={{
            'font-size': '10px',
            'font-weight': 600,
            color: '#8b949e',
            'text-transform': 'uppercase',
            'letter-spacing': '0.04em',
            'margin-bottom': '4px',
          }}
        >
          Grid
        </div>
        <div
          style={{
            display: 'grid',
            'grid-template-columns': 'auto 1fr',
            'row-gap': '1px',
            'font-size': '11px',
          }}
        >
          <div style={{ padding: '3px 0', color: '#8b949e' }}>Zoom</div>
          <div style={{ padding: '3px 0', color: '#c9d1d9' }}>{props.zoom?.toFixed(2) ?? '—'}</div>
          <div style={{ padding: '3px 0', color: '#8b949e' }}>Full detail</div>
          <div style={{ padding: '3px 0', color: '#c9d1d9' }}>{props.fullDetailCount ?? 0} room(s)</div>
        </div>
      </div>
    </div>
  )
}
