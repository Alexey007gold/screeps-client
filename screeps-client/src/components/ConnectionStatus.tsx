import { Show } from 'solid-js'
import { status, isGuest } from '~/stores/clientStore.js'

export function ConnectionStatus() {
  const statusColor = () => {
    switch (status()) {
      case 'connected': return '#238636'
      case 'connecting': return '#d29922'
      case 'error': return '#f85149'
      default: return '#8b949e'
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '12px',
        padding: '8px 16px',
        'border-bottom': '1px solid #30363d',
        'font-size': '13px',
      }}
    >
      <div style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}>
        <span
          style={{
            width: '8px',
            height: '8px',
            'border-radius': '50%',
            'background-color': statusColor(),
            display: 'inline-block',
          }}
        />
        <span style={{ color: '#8b949e' }}>
          {status() === 'connected' ? 'Online' : status()}
        </span>
      </div>
      <Show when={isGuest()}>
        <span
          style={{
            padding: '2px 8px',
            'border-radius': '4px',
            background: '#21262d',
            border: '1px solid #30363d',
            color: '#8b949e',
            'font-size': '11px',
            'font-weight': 600,
            'letter-spacing': '0.05em',
            'text-transform': 'uppercase',
          }}
        >
          Guest
        </span>
      </Show>
    </div>
  )
}
