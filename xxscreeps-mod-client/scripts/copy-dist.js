#!/usr/bin/env node
import { cpSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const src = path.resolve(__dirname, '../../screeps-client/dist/xxscreeps-mod')
const dst = path.resolve(__dirname, '../dist')

if (!existsSync(src)) {
  console.error(`[xxscreeps-mod-client] source not found: ${src}`)
  console.error('Run "pnpm --filter screeps-client build:embedded" first.')
  process.exit(1)
}

rmSync(dst, { recursive: true, force: true })
cpSync(src, dst, { recursive: true })
console.log(`[xxscreeps-mod-client] copied ${src} → ${dst}`)

// Write a self-contained backend.js + index.js into dist/ so that a symlink
// pointing directly at dist/ can be used as an xxscreeps mod path.
// Static files live alongside backend.js, so distDir = __dirname.
const backendSrc = path.resolve(__dirname, '../backend.js')
const backendDst = path.resolve(dst, 'backend.js')
const backendTemplate = readFileSync(backendSrc, 'utf8')
  .replace("const distDir = path.join(__dirname, 'dist')", 'const distDir = __dirname')
writeFileSync(backendDst, backendTemplate, 'utf8')
console.log(`[xxscreeps-mod-client] wrote ${backendDst}`)

const indexSrc = path.resolve(__dirname, '../index.js')
const indexDst = path.resolve(dst, 'index.js')
cpSync(indexSrc, indexDst)
console.log(`[xxscreeps-mod-client] wrote ${indexDst}`)

// Drop a minimal package.json so xxscreeps' mod loader can resolve this
// directory as an ESM package (provides type=module + manifest entry).
const pkgDst = path.resolve(dst, 'package.json')
writeFileSync(pkgDst, JSON.stringify({
  name: 'xxscreeps-mod-client-dist',
  version: '0.0.0',
  type: 'module',
  xxscreeps: true,
  main: 'index.js',
}, null, 2) + '\n', 'utf8')
console.log(`[xxscreeps-mod-client] wrote ${pkgDst}`)
