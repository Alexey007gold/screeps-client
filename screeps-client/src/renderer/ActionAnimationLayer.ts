import { Container, Graphics, Ticker } from 'pixi.js'
import { TILE_SIZE } from './RoomRenderer.js'
import { destroyTree } from './destroyTree.js'
import { ANIM_HARVEST, ANIM_UPGRADE, ANIM_BUILD, ANIM_REPAIR, ANIM_TRANSFER, ANIM_LINK_TRANSFER, ANIM_RANGED_ATTACK, ANIM_ATTACK, ANIM_HEAL, ANIM_DISMANTLE, ANIM_WITHDRAW, ANIM_CLAIM, ANIM_ATTACK_CONTROLLER, ANIM_TOWER_ATTACK, ANIM_TOWER_HEAL, ANIM_TOWER_REPAIR, ANIM_LAB_REACTION } from './colors.js'

export interface BeamAnchor {
  x: number
  y: number
  sprite?: Container | null
}

interface TrackedPoint {
  sprite: Container | null
  px: number
  py: number
}

interface BeamAnimation {
  from: TrackedPoint
  to: TrackedPoint
  startTime: number
  duration: number
  color: number
  width: number
  glowAtSource: boolean  // glow the source end instead of the target (harvest points source → creep)
}

interface WaveAnimation {
  center: TrackedPoint
  maxRadius: number
  startTime: number
  duration: number
  color: number
}

const RANGED_MASS_ATTACK_RANGE = 3
const WAVE_WIDTH = 2
const WAVE_FILL_ALPHA = 0.12

const BEAM_WIDTH = 2
const TOWER_BEAM_WIDTH = 3  // tower beams read as a heavier shot than creep action beams
const GLOW_RADIUS = TILE_SIZE * 0.45  // base impact-glow radius; tower beams scale it up by their wider stroke
const GLOW_ALPHA = 0.55               // peak opacity of the impact-glow core

function trackPoint(anchor: BeamAnchor): TrackedPoint {
  const point: TrackedPoint = {
    sprite: anchor.sprite ?? null,
    px: anchor.x * TILE_SIZE + TILE_SIZE / 2,
    py: anchor.y * TILE_SIZE + TILE_SIZE / 2,
  }
  followSprite(point)
  return point
}

function followSprite(point: TrackedPoint): void {
  const sprite = point.sprite
  if (!sprite) return
  if (sprite.destroyed) {
    point.sprite = null
    return
  }
  point.px = sprite.x + TILE_SIZE / 2
  point.py = sprite.y + TILE_SIZE / 2
}

export class ActionAnimationLayer {
  readonly container: Container
  private graphics: Graphics
  private animations: BeamAnimation[] = []
  private waves: WaveAnimation[] = []
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

  private addBeam(from: BeamAnchor, to: BeamAnchor, durationMs: number, color: number, width = BEAM_WIDTH, glowAtSource = false): void {
    this.animations.push({
      from: trackPoint(from),
      to: trackPoint(to),
      startTime: performance.now(),
      duration: durationMs,
      color,
      width,
      glowAtSource,
    })
  }

  addHarvest(source: BeamAnchor, creep: BeamAnchor, durationMs: number): void {
    this.addBeam(source, creep, durationMs, ANIM_HARVEST, BEAM_WIDTH, true)
  }

  addUpgradeController(from: BeamAnchor, to: BeamAnchor, durationMs: number): void {
    this.addBeam(from, to, durationMs, ANIM_UPGRADE)
  }

  addTransfer(from: BeamAnchor, to: BeamAnchor, durationMs: number): void {
    this.addBeam(from, to, durationMs, ANIM_TRANSFER)
  }

  addBuild(from: BeamAnchor, to: BeamAnchor, durationMs: number): void {
    this.addBeam(from, to, durationMs, ANIM_BUILD)
  }

  // Creep repair: same build/hold/dissolve beam as the build action, driven by the
  // creep's actionLog.repair (target structure position).
  addRepair(from: BeamAnchor, to: BeamAnchor, durationMs: number): void {
    this.addBeam(from, to, durationMs, ANIM_REPAIR)
  }

  // Link-to-link energy transfer: source link → destination link. Same build/hold/dissolve
  // beam as the build action, driven by the source link's actionLog.transferEnergy.
  addLinkTransfer(from: BeamAnchor, to: BeamAnchor, durationMs: number): void {
    this.addBeam(from, to, durationMs, ANIM_LINK_TRANSFER)
  }

  // Lab reaction: a short beam from an input lab into the producing lab, glowing the
  // producing (target) end where the compound forms. Fired twice — once per input lab —
  // so the two streams converge on the output lab. Same build/hold/dissolve motion as build.
  addLabReaction(from: BeamAnchor, to: BeamAnchor, durationMs: number): void {
    this.addBeam(from, to, durationMs, ANIM_LAB_REACTION)
  }

  addRangedAttack(from: BeamAnchor, to: BeamAnchor, durationMs: number): void {
    this.addBeam(from, to, durationMs, ANIM_RANGED_ATTACK)
  }

  addAttack(from: BeamAnchor, to: BeamAnchor, durationMs: number): void {
    this.addBeam(from, to, durationMs, ANIM_ATTACK)
  }

  addHeal(from: BeamAnchor, to: BeamAnchor, durationMs: number): void {
    this.addBeam(from, to, durationMs, ANIM_HEAL)
  }

  addRangedHeal(from: BeamAnchor, to: BeamAnchor, durationMs: number): void {
    this.addBeam(from, to, durationMs, ANIM_HEAL)
  }

  addDismantle(from: BeamAnchor, to: BeamAnchor, durationMs: number): void {
    this.addBeam(from, to, durationMs, ANIM_DISMANTLE)
  }

  addWithdraw(target: BeamAnchor, creep: BeamAnchor, durationMs: number): void {
    this.addBeam(target, creep, durationMs, ANIM_WITHDRAW, BEAM_WIDTH, true)
  }

  addReserveController(from: BeamAnchor, to: BeamAnchor, durationMs: number): void {
    this.addBeam(from, to, durationMs, ANIM_CLAIM)
  }

  addAttackController(from: BeamAnchor, to: BeamAnchor, durationMs: number): void {
    this.addBeam(from, to, durationMs, ANIM_ATTACK_CONTROLLER)
  }

  addRangedMassAttack(center: BeamAnchor, durationMs: number): void {
    this.waves.push({
      center: trackPoint(center),
      maxRadius: (RANGED_MASS_ATTACK_RANGE + 0.5) * TILE_SIZE,
      startTime: performance.now(),
      duration: durationMs,
      color: ANIM_RANGED_ATTACK,
    })
  }

  addTowerAttack(from: BeamAnchor, to: BeamAnchor, durationMs: number): void {
    this.addBeam(from, to, durationMs, ANIM_TOWER_ATTACK, TOWER_BEAM_WIDTH)
  }

  addTowerHeal(from: BeamAnchor, to: BeamAnchor, durationMs: number): void {
    this.addBeam(from, to, durationMs, ANIM_TOWER_HEAL, TOWER_BEAM_WIDTH)
  }

  addTowerRepair(from: BeamAnchor, to: BeamAnchor, durationMs: number): void {
    this.addBeam(from, to, durationMs, ANIM_TOWER_REPAIR, TOWER_BEAM_WIDTH)
  }

  private animate(): void {
    this.graphics.clear()
    const now = performance.now()
    let anyActive = false

    for (let i = this.animations.length - 1; i >= 0; i--) {
      const anim = this.animations[i]
      const elapsed = now - anim.startTime
      const progress = Math.min(1, elapsed / anim.duration)

      followSprite(anim.from)
      followSprite(anim.to)
      const fromX = anim.from.px
      const fromY = anim.from.py
      const toX = anim.to.px
      const toY = anim.to.py

      let startX: number
      let startY: number
      let endX: number
      let endY: number

      const buildRatio = 0.5
      const holdRatio = 0.2

      if (progress < buildRatio) {
        // Build phase: beam grows from source toward target
        const p = progress / buildRatio
        startX = fromX
        startY = fromY
        endX = fromX + (toX - fromX) * p
        endY = fromY + (toY - fromY) * p
      } else if (progress < buildRatio + holdRatio) {
        // Hold phase: full beam visible
        startX = fromX
        startY = fromY
        endX = toX
        endY = toY
      } else {
        // Dissolve phase: beam shrinks from the source (back) toward target
        const p = (progress - buildRatio - holdRatio) / (1 - buildRatio - holdRatio)
        startX = fromX + (toX - fromX) * p
        startY = fromY + (toY - fromY) * p
        endX = toX
        endY = toY
      }

      this.graphics.moveTo(startX, startY)
      this.graphics.lineTo(endX, endY)
      this.graphics.stroke({ width: anim.width, color: anim.color })

      // Vanilla-style round glow that flares as the beam lands, then fades out. Normally on the
      // target; harvest beams point source → creep, so they glow the source end instead.
      if (progress >= buildRatio) {
        const impactT = (progress - buildRatio) / (1 - buildRatio)
        const glowAlpha = (1 - impactT) * GLOW_ALPHA
        const glowRadius = (anim.width / BEAM_WIDTH) * GLOW_RADIUS * (0.7 + 0.5 * impactT)
        const glowX = anim.glowAtSource ? fromX : toX
        const glowY = anim.glowAtSource ? fromY : toY
        this.graphics.circle(glowX, glowY, glowRadius)
        this.graphics.fill({ color: anim.color, alpha: glowAlpha * 0.4 })
        this.graphics.circle(glowX, glowY, glowRadius * 0.55)
        this.graphics.fill({ color: anim.color, alpha: glowAlpha })
      }
      anyActive = true

      if (progress >= 1) {
        this.animations.splice(i, 1)
      }
    }

    for (let i = this.waves.length - 1; i >= 0; i--) {
      const wave = this.waves[i]
      const progress = Math.min(1, (now - wave.startTime) / wave.duration)
      const eased = 1 - (1 - progress) * (1 - progress)
      const radius = Math.max(1, wave.maxRadius * eased)
      const alpha = 1 - progress

      followSprite(wave.center)
      const { px, py } = wave.center
      this.graphics.circle(px, py, radius)
      this.graphics.fill({ color: wave.color, alpha: alpha * WAVE_FILL_ALPHA })
      this.graphics.circle(px, py, radius)
      this.graphics.stroke({ width: WAVE_WIDTH, color: wave.color, alpha })
      anyActive = true

      if (progress >= 1) {
        this.waves.splice(i, 1)
      }
    }

    if (!anyActive) {
      this.graphics.clear()
    }
  }

  clear(): void {
    this.animations.length = 0
    this.waves.length = 0
    this.graphics.clear()
  }

  destroy(): void {
    this.clear()
    if (this.ticker && this.tickerCallback) {
      this.ticker.remove(this.tickerCallback)
    }
    this.ticker = null
    this.tickerCallback = null
    destroyTree(this.container)
  }
}
