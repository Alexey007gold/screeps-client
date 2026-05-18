import { createSignal } from 'solid-js'

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
  duration?: number
}

const [toasts, setToasts] = createSignal<Toast[]>([])
let nextId = 0

export function addToast(message: string, type: 'success' | 'error' = 'success', duration = 4000): void {
  const id = nextId++
  setToasts(prev => [...prev, { id, message, type, duration }])
  setTimeout(() => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, duration)
}

export { toasts }
