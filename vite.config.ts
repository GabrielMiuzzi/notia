import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  copyDrawioRuntimeIntoBuild,
  createDrawioRuntimePlugin,
  DRAWIO_RUNTIME_PUBLIC_BASE,
} from './build/drawioRuntime'

const host = process.env.TAURI_DEV_HOST || '127.0.0.1'
const packageJsonPath = resolve(__dirname, 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string }
const appVersion = typeof packageJson.version === 'string' && packageJson.version.trim().length > 0
  ? packageJson.version.trim()
  : '0.0.0'

export default defineConfig(() => ({
  plugins: [
    react(),
    createDrawioRuntimePlugin(),
    copyDrawioRuntimeIntoBuild(),
  ],
  resolve: {
    alias: {
      settings: resolve(__dirname, 'src/modules/inkdoc/settings.ts'),
    },
  },
  define: {
    __NOTIA_APP_VERSION__: JSON.stringify(appVersion),
    __NOTIA_DRAWIO_RUNTIME_BASE__: JSON.stringify(DRAWIO_RUNTIME_PUBLIC_BASE),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host,
    hmr: {
      protocol: 'ws',
      host: host,
      port: 1421,
    },
    watch: {
      ignored: ['src-tauri/**'],
    },
  },
  optimizeDeps: {
    entries: ['index.html'],
  },
}))
