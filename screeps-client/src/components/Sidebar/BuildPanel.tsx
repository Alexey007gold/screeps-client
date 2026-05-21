import { For, Show } from 'solid-js'
import { buildDraft, setBuildDraft, CONTROLLER_STRUCTURES } from '~/stores/roomViewStore.js'
import { worldStatus } from '~/stores/clientStore.js'
import { controllerLevel, structureCounts } from '~/stores/roomDataStore.js'

export function BuildPanel() {
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
