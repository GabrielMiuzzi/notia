import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const host = process.env.TAURI_DEV_HOST

export default defineConfig(() => ({
  plugins: [react()],
  resolve: {
    alias: {
      settings: resolve(__dirname, 'src/modules/inkdoc/settings.ts'),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
}))
