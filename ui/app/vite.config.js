import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Product routes go to the Python pipeline server (ui/server.py). Without the
// /why proxy, Vite's SPA fallback serves index.html and the trace link appears
// to open another copy of the search screen.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/search': 'http://localhost:8642',
      '/catalog': 'http://localhost:8642',
      '/why': 'http://localhost:8642',
      '/gaps': 'http://localhost:8642',
    },
  },
  build: { outDir: 'dist' },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.js',
    css: false,
    coverage: { provider: 'v8', reporter: ['text-summary', 'lcov'], include: ['src/**/*.{js,jsx}'], exclude: ['src/**/*.test.jsx', 'src/test-setup.js', 'src/main.jsx'] },
  },
})
