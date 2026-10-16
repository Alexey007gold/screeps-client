import { isTypingTarget } from '~/utils/dom.js'

export const KEYBOARD_PAN_SPEED = 900

const PAN_DIRECTIONS: Record<string, { x: number; y: number }> = {
  KeyW: { x: 0, y: 1 },
  KeyS: { x: 0, y: -1 },
  KeyA: { x: 1, y: 0 },
  KeyD: { x: -1, y: 0 },
}

export function clampPan(next: number, current: number, min: number, max: number): number {
  return Math.min(Math.max(max, current), Math.max(Math.min(min, current), next))
}

export class KeyboardPan {
  private readonly held = new Set<string>()
  private readonly target: EventTarget
  private readonly onKeyDown = (e: Event) => this.handleKeyDown(e as KeyboardEvent)
  private readonly onKeyUp = (e: Event) => { this.held.delete((e as KeyboardEvent).code) }
  private readonly onBlur = () => { this.held.clear() }

  constructor(target: EventTarget = window) {
    this.target = target
    target.addEventListener('keydown', this.onKeyDown)
    target.addEventListener('keyup', this.onKeyUp)
    target.addEventListener('blur', this.onBlur)
  }

  step(deltaMS: number): { dx: number; dy: number } | null {
    let x = 0
    let y = 0
    for (const code of this.held) {
      x += PAN_DIRECTIONS[code].x
      y += PAN_DIRECTIONS[code].y
    }
    if (x === 0 && y === 0) return null
    const distance = KEYBOARD_PAN_SPEED * deltaMS / 1000 / Math.hypot(x, y)
    return { dx: x * distance, dy: y * distance }
  }

  destroy(): void {
    this.held.clear()
    this.target.removeEventListener('keydown', this.onKeyDown)
    this.target.removeEventListener('keyup', this.onKeyUp)
    this.target.removeEventListener('blur', this.onBlur)
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      this.held.clear()
      return
    }
    if (!(e.code in PAN_DIRECTIONS) || isTypingTarget(e.target)) return
    this.held.add(e.code)
  }
}
