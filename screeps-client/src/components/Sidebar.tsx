import {For, Show} from 'solid-js'
import { SelectionList } from '~/components/SelectionList.js'
import { RoomInfoPanel } from '~/components/RoomInfoPanel.js'
import { MapInfoPanel } from '~/components/MapInfoPanel.js'
import type { RoomInfo } from '~/components/MapViewer.js'
import {flagDraft, roomViewMode, setFlagDraft} from "~/stores/roomViewStore";

const DENSITY_LABELS = ['Low', 'Medium', 'High', 'Ultra'] as const

const FLAG_COLORS = [
    'COLOR_WHITE',
    'COLOR_GREY',
    'COLOR_RED',
    'COLOR_PURPLE',
    'COLOR_BLUE',
    'COLOR_CYAN',
    'COLOR_GREEN',
    'COLOR_YELLOW',
    'COLOR_ORANGE',
    'COLOR_BROWN',
] as const

function densityLabel(density: number): string {
  return DENSITY_LABELS[density - 1] ?? String(density)
}

function RoomInfoBox(props: { label: string; info: RoomInfo | null; dim?: boolean }) {
  return (
    <div
      style={{
        margin: '8px 8px 0',
        border: `1px solid ${props.dim ? '#21262d' : '#30363d'}`,
        'border-radius': '6px',
        overflow: 'hidden',
        opacity: props.dim ? 0.6 : 1,
      }}
    >
      <div
        style={{
          padding: '4px 8px',
          background: '#161b22',
          'border-bottom': '1px solid #21262d',
          'font-size': '10px',
          'font-weight': 600,
          color: '#8b949e',
          'text-transform': 'uppercase',
          'letter-spacing': '0.04em',
        }}
      >
        {props.label}
      </div>
      <Show
        when={props.info}
        fallback={
          <div style={{ padding: '6px 8px', 'font-size': '11px', color: '#484f58', 'font-style': 'italic' }}>
            None
          </div>
        }
      >
        {(info) => (
          <div style={{ 'font-size': '11px' }}>
            <div
              style={{
                padding: '5px 8px',
                'font-weight': 600,
                color: '#c9d1d9',
                'font-size': '12px',
                'border-bottom': '1px solid #21262d',
              }}
            >
              {info().room}
            </div>
            <div
              style={{
                display: 'grid',
                'grid-template-columns': 'auto 1fr',
                'row-gap': '1px',
                'column-gap': '0',
              }}
            >
              <div style={{ padding: '3px 8px', color: '#8b949e' }}>Owner</div>
              <div style={{ padding: '3px 8px', color: '#c9d1d9' }}>{info().owner ?? 'None'}</div>
              <Show when={info().mineral}>
                <div style={{ padding: '3px 8px', color: '#8b949e' }}>Mineral</div>
                <div style={{ padding: '3px 8px', color: '#79c0ff' }}>{info().mineral}</div>
                <div style={{ padding: '3px 8px', color: '#8b949e' }}>Density</div>
                <div style={{ padding: '3px 8px', color: '#c9d1d9' }}>{densityLabel(info().density ?? 0)}</div>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

function FlagForm() {
    const updateDraft = (patch: Partial<ReturnType<typeof flagDraft>>) => {
        setFlagDraft({ ...flagDraft(), ...patch })
    }

    return (
        <div style={{ flex: 1, overflow: 'auto', 'min-height': 0, padding: '8px' }}>
            <div
                style={{
                    'border-radius': '6px',
                    border: '1px solid #30363d',
                    overflow: 'hidden',
                    background: '#0d1117',
                }}
            >
                <div
                    style={{
                        padding: '6px 8px',
                        background: '#161b22',
                        'border-bottom': '1px solid #21262d',
                        'font-size': '11px',
                        'font-weight': 600,
                        color: '#c9d1d9',
                    }}
                >
                    Create flag
                </div>
                <div style={{ padding: '8px', display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
                    <label style={{ display: 'flex', 'flex-direction': 'column', gap: '4px', 'font-size': '11px', color: '#8b949e' }}>
                        Name
                        <input
                            value={flagDraft().name}
                            onInput={(e) => updateDraft({ name: e.currentTarget.value })}
                            placeholder="Flag name"
                            style={{
                                background: '#010409',
                                color: '#c9d1d9',
                                border: '1px solid #30363d',
                                'border-radius': '4px',
                                padding: '5px 6px',
                                'font-size': '12px',
                            }}
                        />
                    </label>

                    <label style={{ display: 'flex', 'flex-direction': 'column', gap: '4px', 'font-size': '11px', color: '#8b949e' }}>
                        Primary color
                        <select
                            value={flagDraft().color}
                            onChange={(e) => updateDraft({ color: e.currentTarget.value })}
                            style={{
                                background: '#010409',
                                color: '#c9d1d9',
                                border: '1px solid #30363d',
                                'border-radius': '4px',
                                padding: '5px 6px',
                                'font-size': '12px',
                            }}
                        >
                            <For each={FLAG_COLORS}>
                                {(color) => <option value={color}>{color.replace('COLOR_', '')}</option>}
                            </For>
                        </select>
                    </label>

                    <label style={{ display: 'flex', 'flex-direction': 'column', gap: '4px', 'font-size': '11px', color: '#8b949e' }}>
                        Secondary color
                        <select
                            value={flagDraft().secondaryColor}
                            onChange={(e) => updateDraft({ secondaryColor: e.currentTarget.value })}
                            style={{
                                background: '#010409',
                                color: '#c9d1d9',
                                border: '1px solid #30363d',
                                'border-radius': '4px',
                                padding: '5px 6px',
                                'font-size': '12px',
                            }}
                        >
                            <For each={FLAG_COLORS}>
                                {(color) => <option value={color}>{color.replace('COLOR_', '')}</option>}
                            </For>
                        </select>
                    </label>

                    <div style={{ color: '#484f58', 'font-size': '11px', 'line-height': 1.4 }}>
                        Click a position in the room to create the flag there.
                    </div>
                </div>
            </div>
        </div>
    )
}

function BuildPanel() {
    return (
        <div style={{ flex: 1, overflow: 'auto', 'min-height': 0, padding: '8px' }}>
            <div style={{ color: '#484f58', 'font-style': 'italic', 'font-size': '12px' }}>
                Build mode is not implemented yet.
            </div>
        </div>
    )
}

function RoomModePanel() {
    return (
        <Show when={roomViewMode() === 'flag'} fallback={
            <Show when={roomViewMode() === 'build'} fallback={<SelectionList />}>
                <BuildPanel />
            </Show>
        }>
            <FlagForm />
        </Show>
    )
}


interface SidebarProps {
  isCollapsed?: boolean
  onToggle?: () => void
  mapMode?: boolean
  hoveredRoomInfo?: RoomInfo | null
  selectedRoomInfo?: RoomInfo | null
  room?: string
  shard?: string | null
  mapZoom?: number | null
  mapSubsActive?: boolean | null
}

export function Sidebar(props: SidebarProps) {
  const handleStripClick = () => {
    props.onToggle?.()
  }

  const handleButtonClick = (e: MouseEvent) => {
    e.stopPropagation()
    props.onToggle?.()
  }

  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'row',
        height: '100%',
        background: '#0d1117',
      }}
    >
      {/* Collapsed strip – always visible, clickable background */}
      <div
        onClick={handleStripClick}
        style={{
          width: '32px',
          height: '100%',
          display: 'flex',
          'flex-direction': 'column',
          'align-items': 'center',
          'border-right': '1px solid #30363d',
          padding: '8px 0',
          cursor: 'pointer',
        }}
      >
        {props.onToggle && (
          <button
            onClick={handleButtonClick}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8b949e',
              'font-size': '14px',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            {props.isCollapsed ? '▶' : '◀'}
          </button>
        )}
      </div>

      {/* Main content – visible when sidebar is wide enough */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          'flex-direction': 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '6px 10px',
            'border-bottom': '1px solid #30363d',
            'font-size': '12px',
            'font-weight': 600,
            color: '#8b949e',
            display: 'flex',
            'justify-content': 'space-between',
            'align-items': 'center',
          }}
        >
          <span>Properties</span>
          {props.onToggle && (
            <button
              onClick={handleButtonClick}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8b949e',
                'font-size': '11px',
                cursor: 'pointer',
              }}
            >
              Collapse
            </button>
          )}
        </div>

        <Show when={props.mapMode} fallback={
          <RoomInfoPanel room={props.room ?? '—'} shard={props.shard ?? null} />
        }>
          <MapInfoPanel zoom={props.mapZoom} subsActive={props.mapSubsActive} />
        </Show>

        <Show
          when={props.mapMode}
          fallback={<RoomModePanel />}
        >
          <div style={{ 'padding-bottom': '8px', overflow: 'auto', 'min-height': 0 }}>
            <RoomInfoBox label="Selected" info={props.selectedRoomInfo ?? null} />
            <RoomInfoBox label="Cursor" info={props.hoveredRoomInfo ?? null} dim />
          </div>
        </Show>
      </div>
    </div>
  )
}
