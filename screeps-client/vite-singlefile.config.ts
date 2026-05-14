import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [solid(), viteSingleFile()],
  resolve: {
    alias: {
      '~/': '/src/',
      'screeps-connectivity': resolve(__dirname, '../screeps-connectivity/src/index.ts'),
      'screeps-connectivity/file-storage': resolve(__dirname, '../screeps-connectivity/src/file-storage.ts'),
    },
  },
})
