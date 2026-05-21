import { createSignal, createEffect, For, Show } from 'solid-js'
import { createCodeMirror, createEditorControlledValue } from 'solid-codemirror'
import { basicSetup } from 'codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from 'codemirror'
import { client } from '~/stores/clientStore.js'
import { addToast } from '~/stores/toastStore.js'
import { createLogger } from '~/utils/log.js'

const { error } = createLogger('code')

interface Branch {
  _id: string
  branch: string
  activeWorld: boolean
  activeSim: boolean
}

const editorTheme = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': {
    'font-family': "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    'font-size': '13px',
    'line-height': '1.6',
    overflow: 'auto',
  },
  '.cm-gutters': { background: '#0d1117', 'border-right': '1px solid #21262d' },
  '.cm-lineNumbers .cm-gutterElement': { color: '#484f58', 'min-width': '3em' },
  '.cm-activeLineGutter': { background: '#161b22' },
  '.cm-activeLine': { background: '#161b22' },
})

const cmExtensions = [basicSetup, javascript(), oneDark, editorTheme]

export function CodePanel(props: { onClose: () => void }) {
  const [branches, setBranches] = createSignal<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = createSignal<string>('')
  const [modules, setModules] = createSignal<Record<string, string>>({})
  const [activeModule, setActiveModule] = createSignal<string>('')
  const [loading, setLoading] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [dirty, setDirty] = createSignal(false)

  const moduleNames = () => Object.keys(modules())

  const { editorView, ref: editorRef, createExtension } = createCodeMirror({
    onValueChange: (value) => {
      const mod = activeModule()
      // Skip if value matches stored — avoids false dirty on module switch or initial load
      if (!mod || modules()[mod] === value) return
      setModules((prev) => ({ ...prev, [mod]: value }))
      setDirty(true)
    },
  })

  createEditorControlledValue(editorView, () => modules()[activeModule()] ?? '')
  createExtension(cmExtensions)

  createEffect(() => {
    const c = client()
    if (!c) return
    c.http.user.branches()
      .then((res) => {
        setBranches(res.list)
        const active = res.list.find((b) => b.activeWorld) ?? res.list[0]
        if (active) setSelectedBranch(active.branch)
      })
      .catch((err) => {
        error('branches failed:', err)
        addToast('Failed to load branches', 'error')
      })
  })

  createEffect(() => {
    const branch = selectedBranch()
    const c = client()
    if (!branch || !c) return
    setLoading(true)
    setModules({})
    setActiveModule('')
    setDirty(false)
    ;(c.http.user.code.get(branch) as Promise<{ ok: number; modules: Record<string, string> }>)
      .then((res) => {
        const mods = res.modules ?? {}
        setModules(mods)
        setActiveModule(Object.keys(mods)[0] ?? '')
      })
      .catch((err) => {
        error('get failed:', err)
        addToast('Failed to load code', 'error')
      })
      .finally(() => setLoading(false))
  })

  const handleSave = () => {
    const c = client()
    const branch = selectedBranch()
    if (!c || !branch) return
    setSaving(true)
    c.http.user.code.set(branch, modules())
      .then(() => {
        addToast('Code saved', 'success')
        setDirty(false)
      })
      .catch((err) => {
        error('set failed:', err)
        addToast('Failed to save code', 'error')
      })
      .finally(() => setSaving(false))
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: '0px',
        background: '#0d1117',
        'z-index': 100,
        display: 'flex',
        'flex-direction': 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '12px',
          padding: '10px 16px',
          'border-bottom': '1px solid #30363d',
          'flex-shrink': 0,
        }}
      >
        <span style={{ 'font-size': '15px', 'font-weight': 600, color: '#c9d1d9' }}>Code</span>

        <select
          value={selectedBranch()}
          onChange={(e) => setSelectedBranch(e.currentTarget.value)}
          style={{
            background: '#010409',
            color: '#c9d1d9',
            border: '1px solid #30363d',
            'border-radius': '4px',
            padding: '4px 8px',
            'font-size': '12px',
            cursor: 'pointer',
          }}
        >
          <For each={branches()}>
            {(b) => (
              <option value={b.branch}>
                {b.branch}{b.activeWorld ? ' ★' : ''}
              </option>
            )}
          </For>
        </select>

        <div style={{ flex: 1 }} />

        <Show when={dirty()}>
          <span style={{ 'font-size': '11px', color: '#e3b341' }}>Unsaved changes</span>
        </Show>

        <button
          onClick={handleSave}
          disabled={saving() || loading() || !dirty()}
          style={{
            padding: '5px 14px',
            'border-radius': '4px',
            border: '1px solid #238636',
            background: saving() || !dirty() ? '#161b22' : '#1a3a2a',
            color: saving() || !dirty() ? '#484f58' : '#3fb950',
            'font-size': '12px',
            cursor: saving() || !dirty() ? 'default' : 'pointer',
            'font-weight': 600,
          }}
        >
          {saving() ? 'Saving…' : 'Save'}
        </button>

        <button
          onClick={props.onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#8b949e',
            'font-size': '18px',
            cursor: 'pointer',
            'line-height': '1',
            padding: '2px 6px',
          }}
        >
          ✕
        </button>
      </div>

      {/* Body: module list + editor */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Module list */}
        <div
          style={{
            width: '180px',
            'flex-shrink': 0,
            'border-right': '1px solid #21262d',
            display: 'flex',
            'flex-direction': 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '6px 10px',
              'font-size': '10px',
              'font-weight': 700,
              color: '#8b949e',
              'text-transform': 'uppercase',
              'letter-spacing': '0.06em',
              'border-bottom': '1px solid #21262d',
              'flex-shrink': 0,
            }}
          >
            Modules
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <Show when={loading()}>
              <div style={{ padding: '12px 10px', 'font-size': '12px', color: '#484f58', 'font-style': 'italic' }}>
                Loading…
              </div>
            </Show>
            <For each={moduleNames()}>
              {(name) => (
                <div
                  onClick={() => setActiveModule(name)}
                  style={{
                    padding: '7px 12px',
                    'font-size': '12px',
                    cursor: 'pointer',
                    background: activeModule() === name ? '#1f3158' : 'transparent',
                    color: activeModule() === name ? '#58a6ff' : '#c9d1d9',
                    'border-left': `2px solid ${activeModule() === name ? '#388bfd' : 'transparent'}`,
                    'white-space': 'nowrap',
                    overflow: 'hidden',
                    'text-overflow': 'ellipsis',
                  }}
                >
                  {name}
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Editor column */}
        <div style={{ flex: 1, display: 'flex', 'flex-direction': 'column', overflow: 'hidden' }}>

          {/* Module name tab — always in DOM but hidden when no module */}
          <div
            style={{
              display: activeModule() ? 'block' : 'none',
              padding: '5px 14px',
              'font-size': '12px',
              color: '#8b949e',
              'border-bottom': '1px solid #21262d',
              'flex-shrink': 0,
              'font-family': 'monospace',
              background: '#0d1117',
            }}
          >
            {activeModule()}.js
          </div>

          {/* CodeMirror mount point — always in DOM so the view persists across module switches */}
          <div
            ref={editorRef}
            style={{
              display: activeModule() ? 'flex' : 'none',
              flex: 1,
              overflow: 'hidden',
              'flex-direction': 'column',
            }}
          />

          {/* Placeholder shown when no module is active */}
          <Show when={!activeModule()}>
            <div
              style={{
                flex: 1,
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                color: '#484f58',
                'font-size': '13px',
                'font-style': 'italic',
              }}
            >
              {loading() ? 'Loading code…' : 'Select a module'}
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
