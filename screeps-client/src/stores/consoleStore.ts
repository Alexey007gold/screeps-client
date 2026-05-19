import { createSignal } from 'solid-js'

const [showLog, setShowLog] = createSignal(true)
const [showConsole, setShowConsole] = createSignal(true)

export { showLog, showConsole, setShowLog, setShowConsole }

export function toggleShowLog(): void {
  setShowLog((prev) => !prev)
}

export function toggleShowConsole(): void {
  setShowConsole((prev) => !prev)
}
