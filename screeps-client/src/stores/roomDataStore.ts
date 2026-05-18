import { createSignal } from 'solid-js'

const [roomObjectCount, setRoomObjectCount] = createSignal<number | null>(null)
const [roomOwner, setRoomOwner] = createSignal<{ userId: string; username: string } | null>(null)

export { roomObjectCount, setRoomObjectCount, roomOwner, setRoomOwner }
