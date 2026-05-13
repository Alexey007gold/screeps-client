export type LogFn = (...args: unknown[]) => void

export class Logger {
  private readonly fn: LogFn | null

  private constructor(fn: LogFn | null) {
    this.fn = fn
  }

  static create(debug?: boolean | LogFn): Logger {
    if (debug === true) return new Logger(console.debug.bind(console))
    if (typeof debug === 'function') return new Logger(debug)
    return new Logger(null)
  }

  child(namespace: string): Logger {
    if (!this.fn) return this
    const parent = this.fn
    return new Logger((...args: unknown[]) => parent(`[screeps:${namespace}]`, ...args))
  }

  log(...args: unknown[]): void {
    this.fn?.(...args)
  }
}
