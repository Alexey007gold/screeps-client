import { createSignal } from 'solid-js'

const [roomObjectCount, setRoomObjectCount] = createSignal<number | null>(null)

export { roomObjectCount, setRoomObjectCount }
