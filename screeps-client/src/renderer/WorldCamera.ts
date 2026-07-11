import { Application, Container } from 'pixi.js'

// Generic pan/zoom/pinch camera over a grid of equally-sized square cells.
// Extracted and parametrized from MapRenderer's camera code (cellSize was
// hardcoded there as MAP_ROOM_SIZE=150 for the low-detail world map). This
// version is reused by MultiRoomRenderer with cellSize = full room size (600),
// so a "cell" here is a room. MapRenderer itself is left untouched in v1 to
// avoid regressing the shipped map view — see docs/plans for rationale.

export interface WorldCameraBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface VisibleBounds {
  rxMin: number
  rxMax: number
  ryMin: number
  ryMax: number
  strictRxMin: number
  strictRxMax: number
  strictRyMin: number
  strictRyMax: number
}

export interface WorldCameraOptions {
  cellSize: number
  minZoom?: number
  maxZoom?: number
  visibleDebounceMs?: number
  dragMargin?: number
}

export interface WorldCameraCallbacks {
  // sx/sy are the raw screen (canvas-local) coordinates the cell was derived
  // from — callers that need finer-than-cell precision (e.g. hit-testing a
  // tile inside a full-detail room) can re-derive world/local coords from them
  // via screenToWorld without the camera needing to know about tiles at all.
  onHoverCell?: (cx: number, cy: number, sx: number, sy: number) => void
  onHoverEnd?: () => void
  onClickCell?: (cx: number, cy: number, sx: number, sy: number, ctrlKey: boolean) => void
  onVisibleBoundsChanged: (bounds: VisibleBounds) => void
  onZoomChanged?: (zoom: number) => void
}

export class WorldCamera {
  readonly world: Container

  private readonly app: Application
  private readonly cellSize: number
  private readonly minZoom: number
  private readonly maxZoom: number
  private readonly visibleDebounceMs: number
  private readonly dragMargin: number
  private readonly callbacks: WorldCameraCallbacks

  private boundsSet: WorldCameraBounds | null = null
  private lastVisibleBounds: VisibleBounds | null = null

  private animTargetX = 0
  private animTargetY = 0
  private isAnimating = false

  private isDragging = false
  private hasDragged = false
  private dragStartX = 0
  private dragStartY = 0
  private dragWorldX = 0
  private dragWorldY = 0
  private isPinching = false
  private pinchPivotWorldX = 0
  private pinchPivotWorldY = 0
  private pinchStartDist = 0
  private pinchStartScale = 0

  private lastVisibleKey = ''
  private visibleDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private lastCheckX = 0
  private lastCheckY = 0
  private lastCheckScale = 0

  private readonly activePointers = new Map<number, { x: number; y: number }>()
  private readonly canvas: HTMLCanvasElement
  private readonly tickerFn: () => void
  private readonly onPointerMove: (e: PointerEvent) => void
  private readonly onPointerLeave: () => void
  private readonly onPointerDown: (e: PointerEvent) => void
  private readonly onPointerUp: (e: PointerEvent) => void
  private readonly onPointerCancel: (e: PointerEvent) => void
  private readonly onWheel: (e: WheelEvent) => void
  private destroyed = false

  constructor(app: Application, options: WorldCameraOptions, callbacks: WorldCameraCallbacks) {
    this.app = app
    this.cellSize = options.cellSize
    this.minZoom = options.minZoom ?? 0.2
    this.maxZoom = options.maxZoom ?? 5
    this.visibleDebounceMs = options.visibleDebounceMs ?? 5
    this.dragMargin = options.dragMargin ?? 50
    this.callbacks = callbacks

    this.world = new Container()
    this.app.stage.addChild(this.world)

    this.canvas = this.app.canvas as HTMLCanvasElement
    this.canvas.style.touchAction = 'none'
    this.canvas.style.userSelect = 'none'

    this.onPointerMove = (e) => this.handlePointerMove(e)
    this.onPointerLeave = () => { if (!this.isDragging && !this.isPinching) this.callbacks.onHoverEnd?.() }
    this.onPointerDown = (e) => this.handlePointerDown(e)
    this.onPointerUp = (e) => this.handlePointerUp(e)
    this.onPointerCancel = (e) => this.handlePointerCancel(e)
    this.onWheel = (e) => this.handleWheel(e)

    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerleave', this.onPointerLeave)
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointercancel', this.onPointerCancel)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })

    this.tickerFn = () => this.tick()
    this.app.ticker.add(this.tickerFn)
  }

  get zoom(): number {
    return this.world.scale.x
  }

  setZoom(next: number): void {
    next = Math.max(this.minZoom, Math.min(this.maxZoom, next))
    if (next === this.world.scale.x) return
    const cx = this.app.screen.width / 2
    const cy = this.app.screen.height / 2
    this.applyZoomAt(next, cx, cy)
  }

  centerOnCell(cx: number, cy: number, animated = false): void {
    const wx = cx * this.cellSize + this.cellSize / 2
    const wy = cy * this.cellSize + this.cellSize / 2
    const scale = this.world.scale.x
    const destX = this.app.screen.width  / 2 - wx * scale
    const destY = this.app.screen.height / 2 - wy * scale
    if (animated) {
      this.animTargetX = destX
      this.animTargetY = destY
      this.isAnimating = true
    } else {
      this.isAnimating = false
      this.world.x = destX
      this.world.y = destY
    }
  }

  setBounds(minX: number, maxX: number, minY: number, maxY: number): void {
    this.boundsSet = { minX, maxX, minY, maxY }
  }

  clearBounds(): void {
    this.boundsSet = null
  }

  getBounds(): WorldCameraBounds | null {
    return this.boundsSet
  }

  screenToWorld(sx: number, sy: number): { wx: number; wy: number } {
    const scale = this.world.scale.x
    return { wx: (sx - this.world.x) / scale, wy: (sy - this.world.y) / scale }
  }

  screenToCell(sx: number, sy: number): { cx: number; cy: number } {
    const { wx, wy } = this.screenToWorld(sx, sy)
    return { cx: Math.floor(wx / this.cellSize), cy: Math.floor(wy / this.cellSize) }
  }

  // Notify the camera that its viewport (canvas) size changed — recenters to
  // keep the visual midpoint stable, mirroring MapRenderer's ResizeObserver.
  handleResize(oldW: number, oldH: number, newW: number, newH: number): void {
    this.world.x += (newW - oldW) / 2
    this.world.y += (newH - oldH) / 2
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.app.ticker.remove(this.tickerFn)
    if (this.visibleDebounceTimer !== null) {
      clearTimeout(this.visibleDebounceTimer)
      this.visibleDebounceTimer = null
    }
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel)
    this.canvas.removeEventListener('wheel', this.onWheel)
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private applyZoomAt(next: number, pivotScreenX: number, pivotScreenY: number): void {
    const scale = this.world.scale.x
    const wx = (pivotScreenX - this.world.x) / scale
    const wy = (pivotScreenY - this.world.y) / scale
    this.world.scale.set(next)
    this.world.x = pivotScreenX - wx * next
    this.world.y = pivotScreenY - wy * next
    this.callbacks.onZoomChanged?.(next)
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.activePointers.has(e.pointerId)) {
      if (!this.isDragging && !this.isPinching) {
        const rect = this.canvas.getBoundingClientRect()
        this.emitHover(e.clientX - rect.left, e.clientY - rect.top)
      }
      return
    }

    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (this.isPinching && this.activePointers.size === 2) {
      const pts = [...this.activePointers.values()]
      const rect = this.canvas.getBoundingClientRect()
      const newMidX = (pts[0].x + pts[1].x) / 2 - rect.left
      const newMidY = (pts[0].y + pts[1].y) / 2 - rect.top
      const newDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      const newScale = Math.max(this.minZoom, Math.min(this.maxZoom, this.pinchStartScale * (newDist / this.pinchStartDist)))
      this.world.scale.set(newScale)
      this.world.x = newMidX - this.pinchPivotWorldX * newScale
      this.world.y = newMidY - this.pinchPivotWorldY * newScale
      this.callbacks.onZoomChanged?.(newScale)
      return
    }

    if (this.isDragging) {
      const rawDx = e.clientX - this.dragStartX
      const rawDy = e.clientY - this.dragStartY
      if (Math.abs(rawDx) > 3 || Math.abs(rawDy) > 3) this.hasDragged = true
      const b = this.boundsSet
      if (b) {
        const scale = this.world.scale.x
        const MARGIN = this.dragMargin
        const minX = MARGIN - (b.maxX + 1) * this.cellSize * scale
        const maxX = this.app.screen.width  - MARGIN - b.minX * this.cellSize * scale
        const minY = MARGIN - (b.maxY + 1) * this.cellSize * scale
        const maxY = this.app.screen.height - MARGIN - b.minY * this.cellSize * scale
        this.world.x = this.rubberBand(this.dragWorldX + rawDx, minX, maxX)
        this.world.y = this.rubberBand(this.dragWorldY + rawDy, minY, maxY)
      } else {
        this.world.x = this.dragWorldX + rawDx
        this.world.y = this.dragWorldY + rawDy
      }
    }
  }

  private handlePointerDown(e: PointerEvent): void {
    e.preventDefault()
    this.isAnimating = false
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    this.canvas.setPointerCapture(e.pointerId)

    if (this.activePointers.size >= 2) {
      this.isDragging = false
      this.isPinching = true
      const pts = [...this.activePointers.values()]
      const rect = this.canvas.getBoundingClientRect()
      const midX = (pts[0].x + pts[1].x) / 2 - rect.left
      const midY = (pts[0].y + pts[1].y) / 2 - rect.top
      this.pinchStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      this.pinchStartScale = this.world.scale.x
      this.pinchPivotWorldX = (midX - this.world.x) / this.pinchStartScale
      this.pinchPivotWorldY = (midY - this.world.y) / this.pinchStartScale
    } else {
      this.isPinching = false
      this.isDragging = true
      this.hasDragged = false
      this.dragStartX = e.clientX
      this.dragStartY = e.clientY
      this.dragWorldX = this.world.x
      this.dragWorldY = this.world.y
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    this.activePointers.delete(e.pointerId)
    this.canvas.releasePointerCapture(e.pointerId)

    if (this.isPinching) {
      if (this.activePointers.size < 2) {
        this.isPinching = false
        this.isDragging = false
        this.springBack()
      }
      return
    }

    if (this.isDragging) {
      this.isDragging = false
      if (!this.hasDragged) {
        const rect = this.canvas.getBoundingClientRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        const { cx, cy } = this.screenToCell(sx, sy)
        this.callbacks.onClickCell?.(cx, cy, sx, sy, e.ctrlKey || e.metaKey)
      }
      this.springBack()
    }
  }

  private handlePointerCancel(e: PointerEvent): void {
    this.activePointers.delete(e.pointerId)
    this.canvas.releasePointerCapture(e.pointerId)
    if (this.isPinching || this.isDragging) {
      this.isPinching = false
      this.isDragging = false
      this.springBack()
    }
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault()
    if (this.isDragging || this.isPinching) return
    this.isAnimating = false
    const scale  = this.world.scale.x
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    const next   = Math.max(this.minZoom, Math.min(this.maxZoom, scale * factor))
    this.applyZoomAt(next, e.offsetX, e.offsetY)
  }

  // iOS-style rubber-band: full movement within [lower, upper], decelerating damping outside.
  private rubberBand(x: number, lower: number, upper: number): number {
    const size = upper - lower
    if (size <= 0) return x
    if (x >= lower && x <= upper) return x
    const c = 0.55
    if (x < lower) {
      const excess = lower - x
      return lower - (1 - 1 / (excess * c / size + 1)) * size * c
    }
    const excess = x - upper
    return upper + (1 - 1 / (excess * c / size + 1)) * size * c
  }

  // After drag: animate world back if it's been pulled mostly off-screen.
  private springBack(): void {
    const b = this.boundsSet
    if (!b) return
    const scale = this.world.scale.x
    const sw = this.app.screen.width
    const sh = this.app.screen.height
    const MARGIN = this.dragMargin

    const wl = this.world.x + b.minX * this.cellSize * scale
    const wr = this.world.x + (b.maxX + 1) * this.cellSize * scale
    const wt = this.world.y + b.minY * this.cellSize * scale
    const wb = this.world.y + (b.maxY + 1) * this.cellSize * scale

    let tx = this.world.x
    let ty = this.world.y

    if (wr < MARGIN)           tx += MARGIN - wr
    else if (wl > sw - MARGIN) tx -= wl - (sw - MARGIN)
    if (wb < MARGIN)           ty += MARGIN - wb
    else if (wt > sh - MARGIN) ty -= wt - (sh - MARGIN)

    if (tx !== this.world.x || ty !== this.world.y) {
      this.animTargetX = tx
      this.animTargetY = ty
      this.isAnimating = true
    }
  }

  private emitHover(sx: number, sy: number): void {
    const { cx, cy } = this.screenToCell(sx, sy)
    this.callbacks.onHoverCell?.(cx, cy, sx, sy)
  }

  private tick(): void {
    if (this.isAnimating) {
      const dx = this.animTargetX - this.world.x
      const dy = this.animTargetY - this.world.y
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        this.world.x = this.animTargetX
        this.world.y = this.animTargetY
        this.isAnimating = false
      } else {
        this.world.x += dx * 0.2
        this.world.y += dy * 0.2
      }
    }
    this.checkVisibleBounds()
  }

  private checkVisibleBounds(): void {
    const scale = this.world.scale.x
    const worldX = this.world.x
    const worldY = this.world.y

    if (this.lastCheckX === worldX && this.lastCheckY === worldY && this.lastCheckScale === scale) {
      return
    }

    this.lastCheckX = worldX
    this.lastCheckY = worldY
    this.lastCheckScale = scale

    const left   = (-worldX) / scale
    const top    = (-worldY) / scale
    const right  = (this.app.screen.width  - worldX) / scale
    const bottom = (this.app.screen.height - worldY) / scale

    const rxMin = Math.floor(left   / this.cellSize) - 1
    const rxMax = Math.ceil (right  / this.cellSize) - 1
    const ryMin = Math.floor(top    / this.cellSize) - 1
    const ryMax = Math.ceil (bottom / this.cellSize) - 1
    this.lastVisibleBounds = {
      rxMin, rxMax, ryMin, ryMax,
      strictRxMin: rxMin + 1, strictRxMax: rxMax,
      strictRyMin: ryMin + 1, strictRyMax: ryMax,
    }

    const key = `${rxMin},${ryMin},${rxMax},${ryMax}`
    if (key !== this.lastVisibleKey) {
      this.lastVisibleKey = key
      if (this.visibleDebounceTimer !== null) clearTimeout(this.visibleDebounceTimer)
      this.visibleDebounceTimer = setTimeout(() => {
        this.visibleDebounceTimer = null
        this.callbacks.onVisibleBoundsChanged(this.lastVisibleBounds!)
      }, this.visibleDebounceMs)
    }
  }
}
