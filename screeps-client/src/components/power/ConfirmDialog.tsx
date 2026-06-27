import { Show, onMount, onCleanup, type JSX } from 'solid-js'
import { PANEL, BORDER, TEXT, MUTED, ACCENT } from './theme.js'

// Reusable Yes/No modal for the power-creep flows (spend-GPL confirm, reset
// confirm, max-level notice). Enter confirms, Escape cancels. Pass `notice` for
// a single-button acknowledgement (e.g. "max creep level reached").
export function ConfirmDialog(props: {
  title: string
  body?: JSX.Element
  confirmLabel?: string
  cancelLabel?: string
  notice?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onCancel()
      else if (e.key === 'Enter') props.onConfirm()
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  const overlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onCancel()
  }

  return (
    <div
      style={{ position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.65)', 'z-index': 300, display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}
      onClick={overlayClick}
    >
      <div style={{ background: PANEL, border: `1px solid ${BORDER}`, 'border-radius': '10px', padding: '24px', 'max-width': '440px', 'text-align': 'center', 'box-shadow': '0 8px 24px rgba(0,0,0,0.5)' }}>
        <div style={{ color: TEXT, 'font-size': '16px', 'font-weight': 600, 'line-height': '1.4' }}>{props.title}</div>
        <Show when={props.body}>
          <div style={{ color: MUTED, 'font-size': '13px', 'margin-top': '8px', 'line-height': '1.5' }}>{props.body}</div>
        </Show>
        <div style={{ display: 'flex', gap: '10px', 'justify-content': 'center', 'margin-top': '20px' }}>
          <button
            onClick={() => props.onConfirm()}
            style={{ padding: '8px 22px', 'border-radius': '6px', border: 'none', background: ACCENT, color: '#fff', 'font-size': '14px', 'font-weight': 600, cursor: 'pointer' }}
          >
            {props.confirmLabel ?? (props.notice ? 'Close' : 'Yes')}
          </button>
          <Show when={!props.notice}>
            <button
              onClick={() => props.onCancel()}
              style={{ padding: '8px 22px', 'border-radius': '6px', border: `1px solid ${BORDER}`, background: 'transparent', color: TEXT, 'font-size': '14px', cursor: 'pointer' }}
            >
              {props.cancelLabel ?? 'No'}
            </button>
          </Show>
        </div>
      </div>
    </div>
  )
}
