import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid()],
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
