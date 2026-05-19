import { createSignal } from 'solid-js'

const [roomObjectCount, setRoomObjectCount] = createSignal<number | null>(null)
const [roomOwner, setRoomOwner] = createSignal<{ userId: string; username: string } | null>(null)
const [controllerLevel, setControllerLevel] = createSignal<number | null>(null)
const [structureCounts, setStructureCounts] = createSignal<Record<string, number>>({})

export { roomObjectCount, setRoomObjectCount, roomOwner, setRoomOwner, controllerLevel, setControllerLevel, structureCounts, setStructureCounts }
