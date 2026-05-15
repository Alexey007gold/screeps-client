import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid()],
  server: {
    proxy: {
      '/api': {
        //target: 'https://screeps.w4rl0ck.dev',
        target: 'http://localhost:21025',
        changeOrigin: true,
      },
      '/socket': {
       // target: 'https://screeps.w4rl0ck.dev',
        target: 'http://localhost:21025',
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
