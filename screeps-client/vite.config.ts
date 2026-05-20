import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import devtools from 'solid-devtools/vite'

const base = process.env.VITE_BASE ?? '/'
const outDir = process.env.VITE_OUT_DIR ?? 'dist/standalone'

export default defineConfig({
  base,
  plugins: [
    devtools({ autoname: true }),
    solid(),
  ],
  build: {
    outDir,
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        //target: 'https://screeps.w4rl0ck.dev',
      //  target: 'http://localhost:21025',
        target: 'http://zeta.dafire.de',
        //target: 'https://screeps.com',
        changeOrigin: true,
      },
      '/socket': {
        target: 'http://zeta.dafire.de',
       // target: 'https://screeps.w4rl0ck.dev',
        //target: 'http://localhost:21025',
        //target: 'https://screeps.com',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  resolve: {
    conditions: ['development'],
    alias: {
      '~/': '/src/',
    },
  },
})
