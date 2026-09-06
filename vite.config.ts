import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const host = process.env.TAURI_DEV_HOST || '127.0.0.1'
const packageJsonPath = resolve(__dirname, 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string }
const appVersion = typeof packageJson.version === 'string' && packageJson.version.trim().length > 0
  ? packageJson.version.trim()
  : '0.0.0'

export default defineConfig(() => ({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      settings: resolve(__dirname, 'src/modules/inkmath/settings.ts'),
    },
  },
  define: {
    __NOTIA_APP_VERSION__: JSON.stringify(appVersion),
  },
  clearScreen: false,
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
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
      ignored: [
        '**/src-tauri/**',
      ],
    },
  },
  optimizeDeps: {
    entries: ['index.html'],
  },
  build: {
    chunkSizeWarningLimit: 600,
    modulePreload: {
      // Heavy editor dependencies must stay lazy. Vite otherwise emits
      // modulepreload links for dynamic-import dependencies in index.html,
      // making WebView2 parse Milkdown/Mermaid before a document is opened.
      resolveDependencies: (_filename: string, dependencies: string[]) => dependencies.filter((dependency) => {
        return !/(?:vendor-(?:milkdown|mermaid|katex|cytoscape|monaco)-)/.test(dependency)
      }),
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'public-task-manager': resolve(__dirname, 'public-task-manager.html'),
      },
      output: {
        manualChunks(id: string | undefined) {
          if (!id) return undefined
          if (id.includes('node_modules/@mui/material')) return 'vendor-mui'
          if (id.includes('node_modules/lucide-react/')) return 'vendor-lucide'
          if (id.includes('node_modules/@iconify-json/')) return 'vendor-iconify-packs'
          if (id.includes('node_modules/@monaco-editor/') || id.includes('node_modules/monaco-editor/')) {
            return 'vendor-monaco'
          }
          // Keep editor/rendering engines in their lazy view chunks. Assigning
          // them to shared manual chunks makes Rollup import them from main
          // through the preload helper, defeating React.lazy on WebView2.
          return undefined
        },
      },
    },
  },
}))
