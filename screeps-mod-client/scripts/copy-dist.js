#!/usr/bin/env node
const { cpSync, rmSync, existsSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

const src = resolve(__dirname, '../../screeps-client/dist/embedded')
const dst = resolve(__dirname, '../dist')

if (!existsSync(src)) {
  console.error(`[screeps-mod-client] source not found: ${src}`)
  console.error('Run "pnpm --filter screeps-client build:embedded" first.')
  process.exit(1)
}

rmSync(dst, { recursive: true, force: true })
cpSync(src, dst, { recursive: true })
console.log(`[screeps-mod-client] copied ${src} → ${dst}`)

// Write a self-contained index.js into dist/ so that a symlink pointing
// directly at dist/ can be used as a screeps mod entry ("screepsmod-client").
// Static files live alongside this index.js, so distDir = __dirname.
const indexSrc = resolve(__dirname, '../index.js')
const indexDst = resolve(dst, 'index.js')
const template = require('node:fs').readFileSync(indexSrc, 'utf8')
  .replace("path.join(__dirname, 'dist')", '__dirname')
writeFileSync(indexDst, template, 'utf8')
console.log(`[screeps-mod-client] wrote ${indexDst}`)
