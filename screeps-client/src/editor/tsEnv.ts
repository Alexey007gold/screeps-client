import ts from 'typescript'
import { createSystem, createVirtualTypeScriptEnvironment } from '@typescript/vfs'
import type { VirtualTypeScriptEnvironment } from '@typescript/vfs'
import { libFiles, screepsTypes } from 'virtual:screeps-ts-libs'

// Ambient declarations that make Screeps modules edit cleanly without pulling in
// heavy typings. `_` (lodash) is exposed by the runtime but we don't ship its
// types; the CommonJS globals let `module.exports = …` / `require('x')` style
// modules type-check alongside idiomatic `import`/`export` (which transpile to
// the same thing). Kept as an in-memory file, NOT a real src/*.d.ts, so these
// globals never leak into the client app's own type-checking.
const SCREEPS_EXTRAS = `
declare const _: any
declare function require(id: string): any
declare var module: { exports: any }
declare var exports: any
declare var global: any
`

const EXTRAS_PATH = '/screeps-extras.d.ts'

// Screeps runs an ES2019-era isolate with no DOM. Explicit `lib: ["es2019"]`
// (rather than the target default, which would drag in the DOM libs) keeps the
// environment matched to the runtime and the bundle lean.
export const SCREEPS_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2019,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  lib: ['es2019'],
  allowJs: true,
  checkJs: false,
  strict: true,
  noEmit: true,
  esModuleInterop: true,
  skipLibCheck: true,
  forceConsistentCasingInFileNames: true,
  types: ['screeps'],
  // Bare imports (`import { x } from 'utils'`) resolve against the vfs root,
  // where module files live as `/utils.ts` — matching Screeps' flat require().
  baseUrl: '/',
}

function buildFsMap(initialFiles: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>()
  for (const [path, content] of Object.entries(libFiles)) map.set(path, content)
  map.set('/node_modules/@types/screeps/index.d.ts', screepsTypes)
  map.set(
    '/node_modules/@types/screeps/package.json',
    JSON.stringify({ name: '@types/screeps', version: '0.0.0', types: 'index.d.ts' }),
  )
  map.set(EXTRAS_PATH, SCREEPS_EXTRAS)
  for (const [path, content] of Object.entries(initialFiles)) map.set(path, content)
  return map
}

/**
 * Build a browser TypeScript language-service environment preloaded with the
 * Screeps API globals. `initialFiles` maps vfs paths (e.g. `/main.ts`) to source
 * so sibling modules resolve each other's imports from the first keystroke.
 */
export function createScreepsEnv(initialFiles: Record<string, string> = {}): VirtualTypeScriptEnvironment {
  const system = createSystem(buildFsMap(initialFiles))
  const rootFiles = [EXTRAS_PATH, ...Object.keys(initialFiles)]
  return createVirtualTypeScriptEnvironment(system, rootFiles, ts, SCREEPS_COMPILER_OPTIONS)
}
