import { showMapRoomNames, setShowMapRoomNames } from '~/stores/settingsStore.js'

interface MapInfoPanelProps {
  zoom?: number | null
  subsActive?: boolean | null
}

export function MapInfoPanel(props: MapInfoPanelProps) {
  return (
    <div style={{ padding: '8px', 'border-bottom': '1px solid #30363d', 'flex-shrink': 0 }}>
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
          Map
        </div>

        <div
          style={{
            display: 'grid',
            'grid-template-columns': 'auto 1fr',
            'row-gap': '1px',
            'font-size': '11px',
            'margin-bottom': '8px',
          }}
        >
          <div style={{ padding: '3px 0', color: '#8b949e' }}>Zoom</div>
          <div style={{ padding: '3px 0', color: '#c9d1d9' }}>{props.zoom?.toFixed(2) ?? '—'}</div>
          <div style={{ padding: '3px 0', color: '#8b949e' }}>Live</div>
          <div style={{ padding: '3px 0', color: '#c9d1d9' }}>{props.subsActive ? 'Yes' : 'No'}</div>
        </div>

        <label
          style={{
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'space-between',
            'font-size': '11px',
            color: '#c9d1d9',
            cursor: 'pointer',
          }}
        >
          <span>Show room names</span>
          <input
            type="checkbox"
            checked={showMapRoomNames()}
            onChange={(e) => setShowMapRoomNames(e.currentTarget.checked)}
          />
        </label>
      </div>
    </div>
  )
}
