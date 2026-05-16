import { TypedStore } from './TypedStore.js'
import type { Logger } from '../logger.js'

export interface NavigationState {
  room: string | null
  shard: string | null
  index: number
  history: Array<{ room: string; shard: string | null }>
}

export interface NavigationStoreEvents {
  'navigation:change': NavigationState
}

export class NavigationStore extends TypedStore<NavigationStoreEvents> {
  private _history: Array<{ room: string; shard: string | null }> = []
  private _index = -1
  private readonly maxHistory: number

  constructor(maxHistory = 50, logger?: Logger) {
    super(logger)
    this.maxHistory = maxHistory
  }

  navigateTo(room: string, shard: string | null): void {
    this._history = this._history.slice(0, this._index + 1)
    this._history.push({ room, shard })
    if (this._history.length > this.maxHistory) {
      this._history.shift()
    } else {
      this._index++
    }
    this.emit('navigation:change', this.current())
  }

  back(): boolean {
    if (!this.canBack()) return false
    this._index--
    this.emit('navigation:change', this.current())
    return true
  }

  forward(): boolean {
    if (!this.canForward()) return false
    this._index++
    this.emit('navigation:change', this.current())
    return true
  }

  canBack(): boolean { return this._index > 0 }
  canForward(): boolean { return this._index < this._history.length - 1 }

  current(): NavigationState {
    return {
      room: this._history[this._index]?.room ?? null,
      shard: this._history[this._index]?.shard ?? null,
      index: this._index,
      history: [...this._history],
    }
  }
}
