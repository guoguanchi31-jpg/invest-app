import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],
  server: {
    allowedHosts: ['blue-chefs-poke.loca.lt'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/main.jsx', 'src/simulator/main.jsx'],
      thresholds: {
        statements: 45,
        branches: 40,
        functions: 40,
        lines: 45,
      },
    },
  },
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: process.env.VITE_INCLUDE_SIMULATOR === '1'
        ? {
          app: fileURLToPath(new URL('./index.html', import.meta.url)),
          simulator: fileURLToPath(new URL('./simulator.html', import.meta.url)),
        }
        : fileURLToPath(new URL('./index.html', import.meta.url)),
    },
  },
}))
