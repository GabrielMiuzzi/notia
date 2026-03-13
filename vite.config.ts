import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const host = process.env.TAURI_DEV_HOST
const packageJsonPath = resolve(__dirname, 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string }
const appVersion = typeof packageJson.version === 'string' && packageJson.version.trim().length > 0
  ? packageJson.version.trim()
  : '0.0.0'

export default defineConfig(() => ({
  plugins: [react()],
  resolve: {
    alias: {
      settings: resolve(__dirname, 'src/modules/inkdoc/settings.ts'),
    },
  },
  define: {
    __NOTIA_APP_VERSION__: JSON.stringify(appVersion),
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
