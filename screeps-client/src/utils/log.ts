const DEV = import.meta.env.DEV

export interface Logger {
  log: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export function createLogger(namespace: string): Logger {
  const prefix = `[${namespace}]`
  return {
    log: DEV ? (...args: unknown[]) => console.log(prefix, ...args) : () => {},
    warn: DEV ? (...args: unknown[]) => console.warn(prefix, ...args) : () => {},
    error: (...args: unknown[]) => console.error(prefix, ...args),
  }
}
