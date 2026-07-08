import * as Comlink from 'comlink'
import ts from 'typescript'
import { createWorker } from '@valtown/codemirror-ts/worker'
import { createScreepsEnv, SCREEPS_COMPILER_OPTIONS } from './tsEnv.js'

// The language service is seeded empty (extras only); the main thread pushes each
// module's source via updateFile once it has initialized.
const base = createWorker(async () => createScreepsEnv())

// Strip types → CommonJS JS for save. transpileModule never type-checks, so it
// emits even when there are type errors (matching "warn but save"). Independent
// of the language-service env, so it works before/without initialize().
function transpile(code: string): string {
  return ts.transpileModule(code, {
    compilerOptions: SCREEPS_COMPILER_OPTIONS,
    reportDiagnostics: false,
  }).outputText
}

const api = Object.assign({}, base, { transpile })
export type ScreepsWorkerApi = typeof api

Comlink.expose(api)
