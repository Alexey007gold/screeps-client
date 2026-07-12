import { createSignal, createEffect, onCleanup, For, Show } from 'solid-js'
import { createCodeMirror, createEditorControlledValue } from 'solid-codemirror'
import { basicSetup } from 'codemirror'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from 'codemirror'
import { compressToUTF16, decompressFromUTF16, decompress } from 'lz-string'
import { client, serverVersion } from '~/stores/clientStore.js'
import { currentShard } from '~/stores/roomDataStore.js'
import { addToast } from '~/stores/toastStore.js'
import { createLogger } from '~/utils/log.js'
import { LS, getStr, setStr } from '~/utils/storage.js'

const { error } = createLogger('segments')

// Server-side limits: 100 segments of up to 100 KB each.
const SEGMENT_COUNT = 100
const SEGMENT_LIMIT = 100 * 1024

const SEGMENT_IDS = Array.from({ length: SEGMENT_COUNT }, (_, i) => i)

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

const headerBtnStyle = (enabled: boolean) => ({
  padding: '4px 10px',
  'border-radius': '4px',
  border: '1px solid #30363d',
  background: '#161b22',
  color: enabled ? '#c9d1d9' : '#484f58',
  'font-size': '12px',
  cursor: enabled ? 'pointer' : 'default',
} as const)

export function SegmentsPanel(props: { shard: string | null; onClose: () => void }) {
  const shards = () => (serverVersion()?.serverData?.shards ?? []).filter((s): s is string => s !== null)
  // eslint-disable-next-line solid/reactivity -- intentional: seed the shard selection once from the current view; the user changes it via the dropdown afterwards
  const [shard, setShard] = createSignal<string | null>(props.shard ?? currentShard())
  const initialSegment = Number(getStr(LS.segmentsLast) ?? '0')
  const [segment, setSegment] = createSignal(
    Number.isInteger(initialSegment) && initialSegment >= 0 && initialSegment < SEGMENT_COUNT ? initialSegment : 0,
  )
  const [content, setContent] = createSignal('')
  // Bumped to force a re-fetch of the current segment.
  const [reloadTick, setReloadTick] = createSignal(0)
  const [loading, setLoading] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [dirty, setDirty] = createSignal(false)
  // Sizes of segments seen this session (per shard), shown in the segment list.
  const [sizes, setSizes] = createSignal<Record<string, number>>({})

  const sizeKey = (s: string | null, seg: number) => `${s ?? ''}:${seg}`
  const rememberSize = (s: string | null, seg: number, len: number) =>
    setSizes((prev) => ({ ...prev, [sizeKey(s, seg)]: len }))

  createEffect(() => setStr(LS.segmentsLast, String(segment())))

  const { editorView, ref: editorRef, createExtension } = createCodeMirror({
    onValueChange: (value) => {
      if (content() === value) return // doc replace from load/transform, not a user edit
      setContent(value)
      setDirty(true)
    },
  })
  createEditorControlledValue(editorView, content)
  createExtension([basicSetup, oneDark, editorTheme, json(), EditorView.lineWrapping])

  // Load the selected segment. The stale guard drops a slow response once the
  // selection (or shard) has moved on, mirroring the branch loader in CodePanel.
  createEffect(() => {
    const c = client()
    const seg = segment()
    const s = shard()
    reloadTick() // track — Reload re-runs this effect
    if (!c) return
    let stale = false
    onCleanup(() => { stale = true })
    setLoading(true)
    setDirty(false)
    setContent('')
    c.http.user.memory.segment.get(seg, s)
      .then((res) => {
        if (stale) return
        const data = res.data ?? ''
        setContent(data)
        setDirty(false)
        rememberSize(s, seg, data.length)
      })
      .catch((err) => {
        if (stale) return
        error('get failed:', err)
        addToast(`Failed to load segment ${seg}`, 'error')
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })
  })

  const handleSave = () => {
    const c = client()
    if (!c) return
    const seg = segment()
    const s = shard()
    const data = content()
    setSaving(true)
    c.http.user.memory.segment.set(seg, data, s)
      .then(() => {
        addToast(`Segment ${seg} saved`, 'success')
        setDirty(false)
        rememberSize(s, seg, data.length)
      })
      .catch((err) => {
        error('set failed:', err)
        addToast(`Failed to save segment ${seg}`, 'error')
      })
      .finally(() => setSaving(false))
  }

  const handleReload = () => {
    if (dirty() && !confirm('Discard unsaved changes and reload this segment?')) return
    setReloadTick((t) => t + 1)
  }

  const selectSegment = (seg: number) => {
    if (seg === segment()) return
    if (dirty() && !confirm('Discard unsaved changes and switch segments?')) return
    setSegment(seg)
  }

  const selectShard = (s: string) => {
    if (s === shard()) return
    if (dirty() && !confirm('Discard unsaved changes and switch shards?')) return
    setShard(s)
  }

  const applyTransform = (next: string) => {
    setContent(next)
    setDirty(true)
  }

  const handleCompress = () => {
    if (!content()) return
    applyTransform(compressToUTF16(content()))
  }

  // Screeps bots typically store segments with compressToUTF16; try that first,
  // then fall back to plain compress output for data written other ways.
  const handleDecompress = () => {
    const src = content()
    if (!src) return
    const utf16 = decompressFromUTF16(src)
    if (utf16) return applyTransform(utf16)
    const raw = decompress(src)
    if (raw) return applyTransform(raw)
    addToast('Content is not lz-string compressed', 'error')
  }

  const reserializeJson = (indent?: number) => {
    try {
      applyTransform(JSON.stringify(JSON.parse(content()), null, indent))
    } catch {
      addToast('Content is not valid JSON', 'error')
    }
  }

  const overLimit = () => content().length > SEGMENT_LIMIT

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
          gap: '8px',
          padding: '10px 16px',
          'border-bottom': '1px solid #30363d',
          'flex-shrink': 0,
        }}
      >
        <span style={{ 'font-size': '15px', 'font-weight': 600, color: '#c9d1d9' }}>
          Segment {segment()}
        </span>

        <Show when={shards().length > 0}>
          <select
            value={shard() ?? ''}
            onChange={(e) => selectShard(e.currentTarget.value)}
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
            <For each={shards()}>{(s) => <option value={s}>{s}</option>}</For>
          </select>
        </Show>

        <button onClick={handleReload} disabled={loading()} style={headerBtnStyle(!loading())}>
          Reload
        </button>

        <div style={{ width: '1px', height: '18px', background: '#30363d' }} />

        <button
          onClick={() => reserializeJson(2)}
          disabled={loading() || !content()}
          title="Pretty-print the content as JSON"
          style={headerBtnStyle(!loading() && !!content())}
        >
          Format JSON
        </button>
        <button
          onClick={() => reserializeJson()}
          disabled={loading() || !content()}
          title="Re-serialize the content as compact JSON without whitespace"
          style={headerBtnStyle(!loading() && !!content())}
        >
          Minify
        </button>
        <button
          onClick={handleCompress}
          disabled={loading() || !content()}
          title="Compress the content with lz-string (compressToUTF16)"
          style={headerBtnStyle(!loading() && !!content())}
        >
          Compress
        </button>
        <button
          onClick={handleDecompress}
          disabled={loading() || !content()}
          title="Decompress lz-string content (UTF-16, with raw fallback)"
          style={headerBtnStyle(!loading() && !!content())}
        >
          Decompress
        </button>

        <div style={{ flex: 1 }} />

        <span style={{ 'font-size': '11px', color: overLimit() ? '#f85149' : '#8b949e' }}>
          {content().length.toLocaleString()} / {SEGMENT_LIMIT.toLocaleString()} chars
        </span>

        <Show when={dirty()}>
          <span style={{ 'font-size': '11px', color: '#e3b341' }}>Unsaved changes</span>
        </Show>

        <button
          onClick={handleSave}
          disabled={saving() || loading() || !dirty() || overLimit()}
          title={overLimit() ? 'Content exceeds the 100 KB segment limit' : 'Save this segment to the server'}
          style={{
            padding: '5px 14px',
            'border-radius': '4px',
            border: '1px solid #238636',
            background: saving() || !dirty() || overLimit() ? '#161b22' : '#1a3a2a',
            color: saving() || !dirty() || overLimit() ? '#484f58' : '#3fb950',
            'font-size': '12px',
            cursor: saving() || !dirty() || overLimit() ? 'default' : 'pointer',
            'font-weight': 600,
          }}
        >
          {saving() ? 'Saving…' : 'Save'}
        </button>

        <button
          onClick={() => props.onClose()}
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

      {/* Body: segment list + editor */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div
          style={{
            width: '130px',
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
              'border-bottom': '1px solid #21262d',
              'font-size': '10px',
              'font-weight': 700,
              color: '#8b949e',
              'text-transform': 'uppercase',
              'letter-spacing': '0.06em',
              'flex-shrink': 0,
            }}
          >
            Segments
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <For each={SEGMENT_IDS}>
              {(seg) => {
                const active = () => segment() === seg
                const size = () => sizes()[sizeKey(shard(), seg)]
                return (
                  <div
                    onClick={() => selectSegment(seg)}
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      gap: '4px',
                      padding: '5px 8px 5px 12px',
                      'font-size': '12px',
                      'font-family': 'monospace',
                      cursor: 'pointer',
                      background: active() ? '#1f3158' : 'transparent',
                      color: active() ? '#58a6ff' : '#c9d1d9',
                      'border-left': `2px solid ${active() ? '#388bfd' : 'transparent'}`,
                    }}
                  >
                    <span style={{ flex: 1 }}>{seg}</span>
                    <Show when={size() !== undefined}>
                      <span style={{ 'font-size': '10px', color: size() === 0 ? '#484f58' : '#8b949e' }}>
                        {size() === 0 ? 'empty' : `${size()!.toLocaleString()}`}
                      </span>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </div>

        {/* Editor column — mount point stays in DOM so the view persists */}
        <div style={{ flex: 1, display: 'flex', 'flex-direction': 'column', overflow: 'hidden', position: 'relative' }}>
          <div
            ref={editorRef}
            style={{ flex: 1, overflow: 'hidden', display: 'flex', 'flex-direction': 'column' }}
          />
          <Show when={loading()}>
            <div
              style={{
                position: 'absolute',
                inset: '0px',
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                background: 'rgba(13,17,23,0.7)',
                color: '#484f58',
                'font-size': '13px',
                'font-style': 'italic',
              }}
            >
              Loading segment {segment()}…
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
