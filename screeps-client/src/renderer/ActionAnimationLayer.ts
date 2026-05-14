import { Container, Graphics, Ticker } from 'pixi.js'
import { TILE_SIZE } from './RoomRenderer.js'

interface BeamAnimation {
  fromX: number
  fromY: number
  toX: number
  toY: number
  startTime: number
  duration: number
  color: number
  width: number
}

const HARVEST_COLOR = 0xffe066
const UPGRADE_COLOR = 0x79c0ff
const BEAM_WIDTH = 2

function tileCenter(x: number, y: number): { cx: number; cy: number } {
  return {
    cx: x * TILE_SIZE + TILE_SIZE / 2,
    cy: y * TILE_SIZE + TILE_SIZE / 2,
  }
}

export class ActionAnimationLayer {
  readonly container: Container
  private graphics: Graphics
  private animations: BeamAnimation[] = []
  private ticker: Ticker | null = null
  private tickerCallback: (() => void) | null = null

  constructor(ticker?: Ticker) {
    this.container = new Container()
    this.graphics = new Graphics()
    this.container.addChild(this.graphics)

    if (ticker) {
      this.ticker = ticker
      this.tickerCallback = () => this.animate()
      ticker.add(this.tickerCallback)
    }
  }

  addHarvest(fromX: number, fromY: number, toX: number, toY: number, durationMs: number): void {
    const from = tileCenter(fromX, fromY)
    const to = tileCenter(toX, toY)
    this.animations.push({
      fromX: from.cx,
      fromY: from.cy,
      toX: to.cx,
      toY: to.cy,
      startTime: performance.now(),
      duration: durationMs,
      color: HARVEST_COLOR,
      width: BEAM_WIDTH,
    })
  }

  addUpgradeController(fromX: number, fromY: number, toX: number, toY: number, durationMs: number): void {
    const from = tileCenter(fromX, fromY)
    const to = tileCenter(toX, toY)
    this.animations.push({
      fromX: from.cx,
      fromY: from.cy,
      toX: to.cx,
      toY: to.cy,
      startTime: performance.now(),
      duration: durationMs,
      color: UPGRADE_COLOR,
      width: BEAM_WIDTH,
    })
  }

  private animate(): void {
    this.graphics.clear()
    const now = performance.now()
    let anyActive = false

    for (let i = this.animations.length - 1; i >= 0; i--) {
      const anim = this.animations[i]
      const elapsed = now - anim.startTime
      const progress = Math.min(1, elapsed / anim.duration)

      const currentX = anim.fromX + (anim.toX - anim.fromX) * progress
      const currentY = anim.fromY + (anim.toY - anim.fromY) * progress

      this.graphics.moveTo(anim.fromX, anim.fromY)
      this.graphics.lineTo(currentX, currentY)
      this.graphics.stroke({ width: anim.width, color: anim.color })
      anyActive = true

      if (progress >= 1) {
        this.animations.splice(i, 1)
      }
    }

    if (!anyActive) {
      this.graphics.clear()
    }
  }

  clear(): void {
    this.animations.length = 0
    this.graphics.clear()
  }

  destroy(): void {
    this.clear()
    if (this.ticker && this.tickerCallback) {
      this.ticker.remove(this.tickerCallback)
    }
    this.ticker = null
    this.tickerCallback = null
    this.graphics.destroy()
    this.container.destroy()
  }
}
