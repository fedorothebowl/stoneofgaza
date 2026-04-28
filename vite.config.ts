import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
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
