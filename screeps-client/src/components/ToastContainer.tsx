import { For } from 'solid-js'
import { toasts } from '~/stores/toastStore.js'

export function ToastContainer() {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        display: 'flex',
        'flex-direction': 'column',
        gap: '8px',
        'z-index': 9999,
        'pointer-events': 'none',
      }}
    >
      <For each={toasts()}>
        {(toast) => (
          <div
            style={{
              padding: '10px 16px',
              'border-radius': '6px',
              'font-size': '13px',
              color: '#fff',
              background: toast.type === 'error' ? '#da3633' : '#238636',
              'box-shadow': '0 4px 12px rgba(0,0,0,0.4)',
              'max-width': '320px',
              'word-break': 'break-word',
              'pointer-events': 'auto',
              animation: 'toast-in 0.2s ease',
            }}
          >
            {toast.message}
          </div>
        )}
      </For>
    </div>
  )
}
