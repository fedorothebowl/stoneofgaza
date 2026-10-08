import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [
    svelte(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/tfp': {
        target: 'https://data.techforpalestine.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tfp/, ''),
      },
    },
  },
})
