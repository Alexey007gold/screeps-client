import type { Application } from 'pixi.js'

// Watches for a spontaneous WebGL context loss/restore — e.g. macOS reclaiming the
// GPU while the app is backgrounded for a while. PixiJS only auto-recovers a loss it
// forced itself (see GlContextSystem.handleContextLost); a loss the browser triggers
// on its own just gets `preventDefault()`-ed and left for `webglcontextrestored`.
//
// While lost, CPU-backed textures (images/canvases/bitmaps) self-heal — Pixi re-binds
// them from their retained source on first use after restore. GPU-only content
// (RenderTexture output from `renderer.render()`/`generateTexture()`, with no CPU-side
// source to restore from) does not — its backing storage comes back blank and must be
// explicitly repainted. `onRestored` is the hook for that repaint.
export class ContextRecovery {
  private lost = false
  private readonly canvas: HTMLCanvasElement
  private readonly app: Application
  private readonly onRestored: () => void

  private readonly handleLost = (e: Event): void => {
    e.preventDefault()
    this.lost = true
    this.app.ticker.stop()
  }

  private readonly handleRestored = (): void => {
    this.lost = false
    this.onRestored()
    this.app.ticker.start()
  }

  constructor(app: Application, onRestored: () => void) {
    this.app = app
    this.onRestored = onRestored
    this.canvas = app.canvas as HTMLCanvasElement
    this.canvas.addEventListener('webglcontextlost', this.handleLost, false)
    this.canvas.addEventListener('webglcontextrestored', this.handleRestored, false)
  }

  get isLost(): boolean {
    return this.lost
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleLost)
    this.canvas.removeEventListener('webglcontextrestored', this.handleRestored)
  }
}
