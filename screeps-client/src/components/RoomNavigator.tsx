import { createEffect, createSignal, Show } from 'solid-js'
import { isPrivateServer, worldBounds } from '~/stores/clientStore.js'
import { parseRoomName, isRoomInWorld } from '~/utils/roomName.js'

interface RoomNavigatorProps {
  onNavigate: (room: string, shard: string | null) => void
  currentRoom?: string
  currentShard?: string | null
}

export function RoomNavigator(props: RoomNavigatorProps) {
  const [room, setRoom] = createSignal('W1N1')
  const [shard, setShard] = createSignal('shard0')
  const [roomValid, setRoomValid] = createSignal<boolean | null>(null)

  createEffect(() => { setRoom(props.currentRoom ?? 'W1N1') })
  createEffect(() => { setShard(props.currentShard ?? 'shard0') })

  createEffect(() => {
    const r = room()
    const bounds = worldBounds()
    if (!bounds) { setRoomValid(null); return }
    const coord = parseRoomName(r)
    setRoomValid(!!coord && isRoomInWorld(coord.x, coord.y, bounds))
  })

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    props.onNavigate(room(), isPrivateServer() ? null : shard())
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        gap: '8px',
        padding: '8px 16px',
        'align-items': 'center',
      }}
    >
      <span style={{ 'font-size': '12px', color: '#8b949e' }}>Room</span>
      <input
        type="text"
        value={room()}
        onInput={(e) => setRoom(e.currentTarget.value.toUpperCase())}
        style={{
          width: '80px',
          padding: '6px 8px',
          'border-radius': '4px',
          border: `1px solid ${roomValid() === false ? '#f85149' : '#30363d'}`,
          background: '#0d1117',
          color: '#c9d1d9',
          'font-size': '13px',
        }}
      />
      <Show when={roomValid() === false}>
        <span style={{ 'font-size': '11px', color: '#f85149' }}>out of bounds</span>
      </Show>
      <Show when={!isPrivateServer()}>
        <span style={{ 'font-size': '12px', color: '#8b949e' }}>Shard</span>
        <input
          type="text"
          value={shard()}
          onInput={(e) => setShard(e.currentTarget.value)}
          style={{
            width: '80px',
            padding: '6px 8px',
            'border-radius': '4px',
            border: '1px solid #30363d',
            background: '#0d1117',
            color: '#c9d1d9',
            'font-size': '13px',
          }}
        />
      </Show>
      <button
        type="submit"
        style={{
          padding: '6px 14px',
          'border-radius': '4px',
          border: 'none',
          background: '#238636',
          color: '#fff',
          'font-size': '13px',
          cursor: 'pointer',
        }}
      >
        Load
      </button>
    </form>
  )
}
