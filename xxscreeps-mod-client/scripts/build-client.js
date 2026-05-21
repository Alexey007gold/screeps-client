#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.resolve(__dirname, '../../screeps-client')

const base = process.env.SCREEPS_MOD_CLIENT_BUILD_BASE ?? '/'
const outDir = 'dist/xxscreeps-mod'

const env = {
  ...process.env,
  VITE_BASE: base,
  VITE_EMBEDDED: 'true',
  VITE_XXSCREEPS: 'true',
  VITE_OUT_DIR: outDir,
}

console.log(`[xxscreeps-mod-client] building screeps-client (base=${base}, outDir=${outDir})`)

const tsc = spawnSync('pnpm', ['exec', 'tsc'], { cwd: clientDir, stdio: 'inherit', env })
if (tsc.status !== 0) process.exit(tsc.status ?? 1)

const vite = spawnSync('pnpm', ['exec', 'vite', 'build'], { cwd: clientDir, stdio: 'inherit', env })
if (vite.status !== 0) process.exit(vite.status ?? 1)
