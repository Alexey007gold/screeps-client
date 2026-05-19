import { render } from 'solid-js/web'

if (import.meta.env.DEV) {
  await import('@solid-devtools/debugger/setup')
}
import { App } from './app/App.js'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

render(() => <App />, root)
