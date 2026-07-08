import { createRequire } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import type { Plugin } from 'vite'

// Exposes the TypeScript standard-library `.d.ts` files and the Screeps API
// typings as a virtual module, so the in-browser TypeScript language service can
// be seeded entirely from the bundle — no CDN fetch, works offline inside the
// embedded mod-client.
//
// DOM/WebWorker/ScriptHost libs are excluded: Screeps code runs in a Node-like
// isolate with no DOM, and dom.d.ts alone is ~half a megabyte.

const VIRTUAL_ID = 'virtual:screeps-ts-libs'
const RESOLVED_ID = '\0' + VIRTUAL_ID

const EXCLUDE_LIB = /^lib\.(dom|webworker|scripthost)/

function readLibFiles(require: NodeRequire): Record<string, string> {
  const libDir = dirname(require.resolve('typescript'))
  const files: Record<string, string> = {}
  for (const name of readdirSync(libDir)) {
    if (!name.startsWith('lib.') || !name.endsWith('.d.ts')) continue
    if (EXCLUDE_LIB.test(name)) continue
    // @typescript/vfs keys lib files at the filesystem root, e.g. `/lib.es2019.d.ts`.
    files['/' + name] = readFileSync(join(libDir, name), 'utf8')
  }
  return files
}

function readScreepsTypes(require: NodeRequire): string {
  const pkgJson = require.resolve('@types/screeps/package.json')
  const dir = dirname(pkgJson)
  const entry = (JSON.parse(readFileSync(pkgJson, 'utf8')) as { types?: string; typings?: string })
  const rel = entry.types ?? entry.typings ?? 'index.d.ts'
  return readFileSync(join(dir, basename(rel)), 'utf8')
}

export function screepsTsLibs(): Plugin {
  return {
    name: 'screeps-ts-libs',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },
    load(id) {
      if (id !== RESOLVED_ID) return
      const require = createRequire(import.meta.url)
      const libFiles = readLibFiles(require)
      const screepsTypes = readScreepsTypes(require)
      return [
        `export const libFiles = ${JSON.stringify(libFiles)}`,
        `export const screepsTypes = ${JSON.stringify(screepsTypes)}`,
      ].join('\n')
    },
  }
}
