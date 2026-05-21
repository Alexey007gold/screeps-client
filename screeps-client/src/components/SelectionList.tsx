import { For, Show, createSignal, createEffect } from 'solid-js'
import { selection, deselectItem } from '~/stores/selectionStore.js'
import { client, gameTime } from '~/stores/clientStore.js'
import { overlayAction, setOverlayAction } from '~/stores/roomViewStore.js'
import { createLogger } from '~/utils/log.js'
import type { SelectedObject } from '~/stores/selectionStore.js'

const { log, error } = createLogger('SelectionList')

// Mirror the palette from ObjectLayer so colors match
const OBJECT_COLORS: Record<string, string> = {
  creep:       '#f0883e',
  spawn:       '#58a6ff',
  extension:   '#79c0ff',
  tower:       '#3fb950',
  container:   '#8b949e',
  storage:     '#d29922',
  link:        '#a371f7',
  rampart:     '#58a6ff',
  road:        '#484f58',
  wall:        '#21262d',
  extractor:   '#8b949e',
  lab:         '#f778ba',
  terminal:    '#d29922',
  observer:    '#79c0ff',
  powerSpawn:  '#f0883e',
  nuker:       '#f85149',
  factory:     '#8b949e',
  invaderCore: '#f85149',
  source:      '#d29922',
  mineral:     '#79c0ff',
  deposit:     '#d29922',
  controller:  '#58a6ff',
  powerBank:   '#f0883e',
  portal:      '#a371f7',
  energy:      '#d29922',
}

const TYPE_LABELS: Record<string, string> = {
  creep:       'Creep',
  spawn:       'Spawn',
  extension:   'Extension',
  tower:       'Tower',
  container:   'Container',
  storage:     'Storage',
  link:        'Link',
  rampart:     'Rampart',
  road:        'Road',
  wall:        'Wall',
  extractor:   'Extractor',
  lab:         'Lab',
  terminal:    'Terminal',
  observer:    'Observer',
  powerSpawn:  'Power Spawn',
  nuker:       'Nuker',
  factory:     'Factory',
  invaderCore: 'Invader Core',
  source:      'Source',
  mineral:     'Mineral',
  deposit:     'Deposit',
  controller:  'Controller',
  powerBank:   'Power Bank',
  portal:      'Portal',
  energy:      'Energy',
  flag:        'Flag',
}

/** Fields we want to surface as key-value rows (exclude noisy / structural ones) */
const SKIP_FIELDS = new Set(['x', 'y', 'type', 'id', 'name', 'user', '_id', 'room', 'hitsMax', 'energyCapacity'])
const NUMERIC_FIELDS = new Set(['hits', 'energy', 'energyCapacity', 'store', 'progress', 'progressTotal', 'nextDecayTime'])

function formatValue(value: unknown): string | null {
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return null
}

function DefaultDetails(props: { item: SelectedObject }) {
  // Collect displayable flat fields from the raw object
  const fields = () => {
    const raw = props.item.raw as Record<string, unknown>
    const pairs: { key: string; value: string }[] = []
    for (const k in raw) {
      if (SKIP_FIELDS.has(k)) continue
      
      const v = raw[k]
      const finalKey = k
      let finalValue = formatValue(v)

      if (k === 'hits' && typeof raw.hitsMax === 'number') {
        finalValue = `${v} / ${raw.hitsMax}`
      }

      if (k === 'energy' && typeof raw.energyCapacity === 'number') {
        finalValue = `${v} / ${raw.energyCapacity}`
      }

      if (k === 'nextDecayTime' && typeof v === 'number') {
        const gt = gameTime()
        if (gt !== null) {
          finalValue = String(v - gt)
        }
      }

      // Prioritise NUMERIC_FIELDS first, then show others
      if (finalValue !== null) pairs.push({ key: finalKey, value: finalValue })
    }
    // Sort: NUMERIC_FIELDS first
    pairs.sort((a, b) => {
      const aP = NUMERIC_FIELDS.has(a.key) ? 0 : 1
      const bP = NUMERIC_FIELDS.has(b.key) ? 0 : 1
      return aP - bP
    })
    return pairs
  }

  return (
    <Show when={fields().length > 0}>
      <div
        style={{
          display: 'grid',
          'grid-template-columns': '1fr 1fr',
          gap: '1px',
          background: '#21262d',
          'font-size': '10px',
        }}
      >
        <For each={fields()}>
          {(field) => (
            <>
              <div
                style={{
                  padding: '3px 8px',
                  background: '#0d1117',
                  color: '#8b949e',
                  overflow: 'hidden',
                  'text-overflow': 'ellipsis',
                  'white-space': 'nowrap',
                }}
              >
                {field.key}
              </div>
              <div
                style={{
                  padding: '3px 8px',
                  background: '#0d1117',
                  color: '#c9d1d9',
                  overflow: 'hidden',
                  'text-overflow': 'ellipsis',
                  'white-space': 'nowrap',
                  'font-variant-numeric': 'tabular-nums',
                }}
              >
                {field.value}
              </div>
            </>
          )}
        </For>
      </div>
    </Show>
  )
}

function StoreDetails(props: { store?: Record<string, number> }) {
  const items = () => {
    const storeObj = props.store || {}
    const arr: [string, number][] = []
    for (const res in storeObj) {
      arr.push([res, storeObj[res]])
    }
    return arr
  }

  return (
    <Show when={items().length > 0}>
      <div style={{ background: '#21262d', 'border-top': '1px solid #30363d', 'font-size': '10px' }}>
        <div style={{ padding: '4px 8px', background: '#161b22', color: '#8b949e', 'font-weight': 600 }}>
          Store Contents
        </div>
        <div style={{ display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '1px', background: '#21262d' }}>
          <For each={items()}>
            {([res, amount]) => (
              <>
                <div style={{ padding: '3px 8px', background: '#0d1117', color: '#8b949e' }}>
                  {res}
                </div>
                <div style={{ padding: '3px 8px', background: '#0d1117', color: '#c9d1d9', 'font-variant-numeric': 'tabular-nums' }}>
                  {amount}
                </div>
              </>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}

function CreepDetails(props: { item: SelectedObject }) {
  const store = () => props.item.raw.store as Record<string, number> | undefined
  return (
    <>
      <DefaultDetails item={props.item} />
      <StoreDetails store={store()} />
    </>
  )
}

const FLAG_COLOR_OPTIONS = [
  { label: 'Red', value: 1 },
  { label: 'Purple', value: 2 },
  { label: 'Blue', value: 3 },
  { label: 'Cyan', value: 4 },
  { label: 'Green', value: 5 },
  { label: 'Yellow', value: 6 },
  { label: 'Orange', value: 7 },
  { label: 'Brown', value: 8 },
  { label: 'Grey', value: 9 },
  { label: 'White', value: 10 },
]

function FlagDetails(props: { item: SelectedObject }) {
  const raw = () => props.item.raw as Record<string, unknown>
  const name = () => (typeof raw().name === 'string' ? (raw().name as string) : '')
  const room = () => (typeof raw().room === 'string' ? (raw().room as string) : '')
  const currentColor = () => (typeof raw().color === 'number' ? (raw().color as number) : 1)
  const currentSecondaryColor = () =>
    typeof raw().secondaryColor === 'number' ? (raw().secondaryColor as number) : 1

  const [draftColor, setDraftColor] = createSignal(currentColor())
  const [draftSecondaryColor, setDraftSecondaryColor] = createSignal(currentSecondaryColor())

  createEffect(() => {
    setDraftColor(currentColor())
    setDraftSecondaryColor(currentSecondaryColor())
  })

  const hasChanges = () =>
    draftColor() !== currentColor() || draftSecondaryColor() !== currentSecondaryColor()

  const handleApply = () => {
    const c = client()
    if (!c) return
    const primary = draftColor()
    const secondary = draftSecondaryColor()
    log(`changeFlagColor: name="${name()}" room=${room()} primary=${primary} secondary=${secondary}`)
    c.http.game.changeFlagColor(room(), name(), primary, secondary)
      .then(() => log('changeFlagColor OK'))
      .catch((err: Error) => error('changeFlagColor FAILED:', err))
  }

  const isMovingThisFlag = () => {
    const oa = overlayAction()
    return oa?.type === 'moveFlag' && oa.id === props.item.id
  }

  const handleMoveToggle = () => {
    if (isMovingThisFlag()) {
      setOverlayAction(null)
      return
    }
    setOverlayAction({
      type: 'moveFlag',
      id: props.item.id,
      name: name(),
      room: room(),
      color: draftColor(),
      secondaryColor: draftSecondaryColor(),
    })
  }

  const [confirming, setConfirming] = createSignal(false)
  let confirmTimeout: ReturnType<typeof setTimeout> | null = null

  const handleDelete = () => {
    if (!confirming()) {
      setConfirming(true)
      confirmTimeout = setTimeout(() => {
        setConfirming(false)
      }, 3000)
      return
    }

    if (confirmTimeout) {
      clearTimeout(confirmTimeout)
      confirmTimeout = null
    }
    setConfirming(false)

    const c = client()
    if (!c) return
    c.http.game.removeFlag(room(), name())
      .then(() => {
        deselectItem(props.item.id)
      })
      .catch(() => {})
  }

  const selectStyle = {
    background: '#010409',
    color: '#c9d1d9',
    border: '1px solid #30363d',
    'border-radius': '4px',
    padding: '5px 6px',
    'font-size': '12px',
    width: '100%',
  }

  const labelStyle = {
    display: 'flex',
    'flex-direction': 'column',
    gap: '4px',
    'font-size': '11px',
    color: '#8b949e',
  } as const

  return (
    <div style={{ padding: '8px', display: 'flex', 'flex-direction': 'column', gap: '8px', background: '#0d1117' }}>
      <label style={labelStyle}>
        Primary color
        <select
          value={draftColor()}
          onChange={(e) => setDraftColor(Number(e.currentTarget.value))}
          style={selectStyle}
        >
          <For each={FLAG_COLOR_OPTIONS}>
            {(opt) => <option value={opt.value}>{opt.label}</option>}
          </For>
        </select>
      </label>

      <label style={labelStyle}>
        Secondary color
        <select
          value={draftSecondaryColor()}
          onChange={(e) => setDraftSecondaryColor(Number(e.currentTarget.value))}
          style={selectStyle}
        >
          <For each={FLAG_COLOR_OPTIONS}>
            {(opt) => <option value={opt.value}>{opt.label}</option>}
          </For>
        </select>
      </label>

      <button
        onClick={handleApply}
        disabled={!hasChanges()}
        style={{
          background: hasChanges() ? '#238636' : '#1f6feb',
          color: '#fff',
          border: 'none',
          'border-radius': '4px',
          padding: '6px 8px',
          'font-size': '12px',
          cursor: hasChanges() ? 'pointer' : 'not-allowed',
          opacity: hasChanges() ? 1 : 0.6,
          transition: 'opacity 150ms ease, background 150ms ease',
        }}
        onMouseEnter={(e) => {
          if (hasChanges()) e.currentTarget.style.background = '#2ea043'
        }}
        onMouseLeave={(e) => {
          if (hasChanges()) e.currentTarget.style.background = '#238636'
        }}
      >
        Apply color
      </button>

      <button
        onClick={handleMoveToggle}
        style={{
          background: isMovingThisFlag() ? '#8b949e' : '#d29922',
          color: '#fff',
          border: 'none',
          'border-radius': '4px',
          padding: '6px 8px',
          'font-size': '12px',
          cursor: 'pointer',
          transition: 'background 150ms ease',
        }}
        onMouseEnter={(e) => {
          if (!isMovingThisFlag()) e.currentTarget.style.background = '#e3b341'
        }}
        onMouseLeave={(e) => {
          if (!isMovingThisFlag()) e.currentTarget.style.background = '#d29922'
        }}
      >
        {isMovingThisFlag() ? 'Abort' : 'Move flag'}
      </button>

      <button
        onClick={handleDelete}
        style={{
          background: confirming() ? '#da3633' : '#f85149',
          color: '#fff',
          border: 'none',
          'border-radius': '4px',
          padding: '6px 8px',
          'font-size': '12px',
          cursor: 'pointer',
          'margin-top': '4px',
          transition: 'background 150ms ease',
        }}
        onMouseEnter={(e) => {
          if (!confirming()) e.currentTarget.style.background = '#da3633'
        }}
        onMouseLeave={(e) => {
          if (!confirming()) e.currentTarget.style.background = '#f85149'
        }}
      >
        {confirming() ? 'Confirm deletion' : 'Delete flag'}
      </button>
    </div>
  )
}

import { JSX } from 'solid-js'
const CUSTOM_DETAILS: Record<string, (props: { item: SelectedObject }) => JSX.Element> = {
  creep: CreepDetails,
  flag: FlagDetails,
}

function SelectionItem(props: { item: SelectedObject }) {
  const color = () => OBJECT_COLORS[props.item.type] ?? '#c9d1d9'
  const label = () => TYPE_LABELS[props.item.type] ?? props.item.type

  const DetailsRenderer = CUSTOM_DETAILS[props.item.type] || DefaultDetails

  return (
    <div
      style={{
        'border-radius': '6px',
        border: '1px solid #30363d',
        'margin-bottom': '6px',
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '7px',
          padding: '6px 8px',
          background: '#161b22',
          'border-bottom': '1px solid #21262d',
        }}
      >
        {/* Color dot */}
        <div
          style={{
            width: '8px',
            height: '8px',
            'border-radius': '50%',
            background: color(),
            'flex-shrink': 0,
          }}
        />
        <span
          style={{
            'font-size': '11px',
            'font-weight': 600,
            color: '#c9d1d9',
            flex: 1,
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
            'white-space': 'nowrap',
          }}
        >
          {label()}
          <Show when={typeof props.item.raw.name === 'string' && props.item.raw.name}>
            {(name) => (
              <span style={{ 'font-weight': 400, color: '#8b949e', 'margin-left': '5px' }}>
                {name() as string}
              </span>
            )}
          </Show>
        </span>
        <span style={{ 'font-size': '10px', color: '#484f58', 'flex-shrink': 0, 'margin-right': '2px' }}>
          ({props.item.raw.x},{props.item.raw.y})
        </span>
        <button
          onClick={() => deselectItem(props.item.id)}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#8b949e',
            cursor: 'pointer',
            padding: '0 4px',
            'font-size': '14px',
            'line-height': 1,
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center'
          }}
          title="Deselect"
          onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#8b949e')}
        >
          ×
        </button>
      </div>

      <DetailsRenderer item={props.item} />
    </div>
  )
}

export function SelectionList() {
  return (
    <div style={{ flex: 1, overflow: 'auto', 'min-height': 0, padding: '8px' }}>
      <Show
        when={selection().length > 0}
        fallback={
          <div style={{ color: '#484f58', 'font-style': 'italic', 'font-size': '12px' }}>
            Click a tile to select objects…
          </div>
        }
      >
        <For each={selection()}>
          {(item) => <SelectionItem item={item} />}
        </For>
      </Show>
    </div>
  )
}
