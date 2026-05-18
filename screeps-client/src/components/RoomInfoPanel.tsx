import { gameTime, tickDuration } from '~/stores/clientStore.js'
import { roomObjectCount } from '~/stores/roomDataStore.js'

interface RoomInfoPanelProps {
  room: string
  shard: string | null
}

export function RoomInfoPanel(props: RoomInfoPanelProps) {
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
          Room
        </div>
        <div style={{ 'font-size': '13px', 'font-weight': 600, color: '#c9d1d9' }}>
          {props.room}
        </div>
        <div
          style={{
            display: 'grid',
            'grid-template-columns': 'auto 1fr',
            'row-gap': '1px',
            'margin-top': '4px',
            'font-size': '11px',
          }}
        >
          <div style={{ padding: '3px 0', color: '#8b949e' }}>Shard</div>
          <div style={{ padding: '3px 0', color: '#c9d1d9' }}>{props.shard ?? '—'}</div>
          <div style={{ padding: '3px 0', color: '#8b949e' }}>Tick</div>
          <div style={{ padding: '3px 0', color: '#c9d1d9' }}>{gameTime() ?? '—'}</div>
          <div style={{ padding: '3px 0', color: '#8b949e' }}>Tick duration</div>
          <div style={{ padding: '3px 0', color: '#c9d1d9' }}>
            {tickDuration() ? `${tickDuration()}ms` : '—'}
          </div>
          <div style={{ padding: '3px 0', color: '#8b949e' }}>Objects</div>
          <div style={{ padding: '3px 0', color: '#c9d1d9' }}>{roomObjectCount() ?? '—'}</div>
        </div>
      </div>
    </div>
  )
}
