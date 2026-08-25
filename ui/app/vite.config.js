import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// /search and /catalog go to the Python pipeline server (ui/server.py)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/search': 'http://localhost:8642',
      '/catalog': 'http://localhost:8642',
    },
  },
  build: { outDir: 'dist' },
})
