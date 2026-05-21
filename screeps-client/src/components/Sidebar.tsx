import {For, Show, createEffect, createSignal} from 'solid-js'
import { SelectionList } from '~/components/SelectionList.js'
import { RoomInfoPanel } from '~/components/RoomInfoPanel.js'
import { MapInfoPanel } from '~/components/MapInfoPanel.js'
import type { RoomInfo } from '~/components/MapViewer.js'
import {flagDraft, roomViewMode, setFlagDraft, pendingTile, buildDraft, setBuildDraft, CONTROLLER_STRUCTURES} from "~/stores/roomViewStore";
import { client, userFlags, worldStatus } from '~/stores/clientStore.js'
import { controllerLevel, structureCounts } from '~/stores/roomDataStore.js'

import { FLAG_COLORS as FLAG_COLOR_HEXES } from '~/renderer/colors.js'

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

    const [nameError, setNameError] = createSignal<string | null>(null)
    const [isChecking, setIsChecking] = createSignal(false)
    let checkTimeout: ReturnType<typeof setTimeout> | null = null

    // Auto-generate a unique flag name when entering flag mode with an empty name
    createEffect(() => {
        if (roomViewMode() !== 'flag') return
        if (flagDraft().name.trim() !== '') return

        const c = client()
        if (!c) return

        c.http.game.genUniqueFlagName()
            .then((res) => {
                updateDraft({ name: res.name })
                setNameError(null)
            })
            .catch((err) => {
                console.error('[flag] gen unique name failed:', err)
            })
    })

    const handleNameInput = (value: string) => {
        updateDraft({ name: value })
        setNameError(null)

        if (checkTimeout) {
            clearTimeout(checkTimeout)
        }

        const trimmed = value.trim()
        if (!trimmed) {
            setIsChecking(false)
            return
        }

        setIsChecking(true)
        checkTimeout = setTimeout(() => {
            const c = client()
            if (!c) {
                setIsChecking(false)
                return
            }

            c.http.game.checkUniqueFlagName(trimmed)
                .then(() => {
                    setNameError(null)
                })
                .catch((err: Error) => {
                    setNameError(err.message)
                })
                .finally(() => {
                    setIsChecking(false)
                })
        }, 300)
    }

    const flags = () => {
        const f = userFlags()
        const arr: [string, { room: string; x: number; y: number; color?: number; secondaryColor?: number }][] = []
        for (const [name, data] of Object.entries(f)) {
            if (data && typeof data === 'object' && 'room' in data && 'x' in data && 'y' in data) {
                arr.push([name, data as { room: string; x: number; y: number; color?: number; secondaryColor?: number }])
            }
        }
        return arr
    }

    const flagColorCss = (colorNum?: number) => {
        if (colorNum === undefined || colorNum < 0 || colorNum >= FLAG_COLOR_HEXES.length) return '#8b949e'
        const hex = FLAG_COLOR_HEXES[colorNum]
        return `#${hex.toString(16).padStart(6, '0')}`
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
                            onInput={(e) => handleNameInput(e.currentTarget.value)}
                            placeholder="Flag name"
                            style={{
                                background: '#010409',
                                color: '#c9d1d9',
                                border: `1px solid ${nameError() ? '#f85149' : '#30363d'}`,
                                'border-radius': '4px',
                                padding: '5px 6px',
                                'font-size': '12px',
                            }}
                        />
                        <Show when={nameError()}>
                            {(err) => (
                                <span style={{ color: '#f85149', 'font-size': '11px' }}>
                                    {err()}
                                </span>
                            )}
                        </Show>
                        <Show when={isChecking()}>
                            <span style={{ color: '#8b949e', 'font-size': '11px' }}>Checking…</span>
                        </Show>
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
                        {pendingTile()
                            ? `Marked at x=${pendingTile()!.tx}, y=${pendingTile()!.ty}. Click again to create the flag, or click elsewhere to move the mark.`
                            : 'Click a position in the room to mark it.'}
                    </div>
                </div>
            </div>

            <Show when={flags().length > 0} fallback={
                <div style={{ 'margin-top': '8px', color: '#484f58', 'font-style': 'italic', 'font-size': '12px' }}>
                    No flags.
                </div>
            }>
                <div style={{ 'margin-top': '8px' }}>
                    <div
                        style={{
                            padding: '6px 8px',
                            'font-size': '11px',
                            'font-weight': 600,
                            color: '#c9d1d9',
                            'margin-bottom': '6px',
                        }}
                    >
                        Your flags
                    </div>
                    <For each={flags()}>
                        {([name, flag]) => (
                            <div
                                style={{
                                    'border-radius': '6px',
                                    border: '1px solid #30363d',
                                    'margin-bottom': '6px',
                                    overflow: 'hidden',
                                }}
                            >
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
                                    <div
                                        style={{
                                            width: '8px',
                                            height: '8px',
                                            'border-radius': '50%',
                                            background: flagColorCss(flag.color),
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
                                        {name}
                                    </span>
                                    <span style={{ 'font-size': '10px', color: '#8b949e', 'flex-shrink': 0 }}>
                                        {flag.room}
                                    </span>
                                    <span style={{ 'font-size': '10px', color: '#484f58', 'flex-shrink': 0, 'margin-left': '4px' }}>
                                        ({flag.x},{flag.y})
                                    </span>
                                </div>
                            </div>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    )
}

function BuildPanel() {
    const structureTypes = Object.keys(CONTROLLER_STRUCTURES)

    const getMaxForLevel = (type: string, rcl: number): number => {
        const levels = CONTROLLER_STRUCTURES[type]
        if (!levels) return 0
        if (worldStatus() === 'empty' && type === 'spawn') {
            return Math.max(levels[rcl] ?? 0, 1)
        }
        return levels[rcl] ?? 0
    }

    const getRemaining = (type: string, rcl: number): number => {
        const max = getMaxForLevel(type, rcl)
        if (max === 2500) return Infinity
        const current = structureCounts()[type] ?? 0
        return Math.max(0, max - current)
    }

    const handleSelectType = (type: string) => {
        setBuildDraft({ structureType: type, structureName: '' })
    }

    return (
        <div style={{ flex: 1, overflow: 'auto', 'min-height': 0, padding: '8px' }}>
            <div
                style={{
                    'border-radius': '6px',
                    border: '1px solid #30363d',
                    overflow: 'hidden',
                    background: '#0d1117',
                    'margin-bottom': '8px',
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
                    Controller Level {controllerLevel() ?? '?'}
                </div>
                <div style={{ padding: '8px', 'font-size': '11px', color: '#8b949e' }}>
                    {(() => {
                        const status = worldStatus()
                        if (status === 'empty') return 'World is empty — place a spawn to claim this room.'
                        if (status === 'lost') return 'You lost all your spawns — respawn to continue.'
                        return controllerLevel() != null
                            ? `RCL ${controllerLevel()} — Select a structure type and click a tile to build.`
                            : 'No controller — roads and containers only.'
                    })()}
                </div>
            </div>

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
                        Structures
                    </div>
                    <For each={structureTypes}>
                        {(type) => {
                            const rcl = () => controllerLevel() ?? 0
                            const max = () => getMaxForLevel(type, rcl())
                            const current = () => structureCounts()[type] ?? 0
                            const isSelected = () => buildDraft().structureType === type
                            const isUnlimited = () => max() === 2500
                            const isMaxed = () => !isUnlimited() && getRemaining(type, rcl()) <= 0

                            return (
                                <Show when={max() > 0}>
                                    <div
                                        onClick={() => !isMaxed() && handleSelectType(type)}
                                        style={{
                                            padding: '6px 8px',
                                            display: 'flex',
                                            'justify-content': 'space-between',
                                            'align-items': 'center',
                                            'border-bottom': '1px solid #21262d',
                                            background: isSelected() ? '#1f3158' : 'transparent',
                                            cursor: isMaxed() ? 'default' : 'pointer',
                                            opacity: isMaxed() ? 0.5 : 1,
                                            'font-size': '11px',
                                            color: '#c9d1d9',
                                        }}
                                    >
                                        <span style={{ 'text-transform': 'capitalize' }}>
                                            {type.replace(/([A-Z])/g, ' $1').trim()}
                                            {isSelected() && ' ✓'}
                                        </span>
                                        <span style={{ color: '#8b949e' }}>
                                            {isUnlimited()
                                                ? `${current()}/∞`
                                                : `${current()}/${max()}`}
                                            {isMaxed() && ' (Max)'}
                                        </span>
                                    </div>
                                </Show>
                            )
                        }}
                    </For>
                </div>

                <div style={{ 'margin-top': '8px', padding: '0 4px' }}>
                    <div style={{ color: '#484f58', 'font-style': 'italic', 'font-size': '12px' }}>
                        {buildDraft().structureType
                            ? 'Click a tile in the room to build.'
                            : 'Select a structure type, then click a tile.'}
                    </div>
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
