import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src-tauri/target', 'src-tauri/vendor']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // The interface reaches the backend only through services/transport;
    // services/window keeps what belongs to the window hosting it.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/services/transport/**', 'src/services/window/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@tauri-apps/*'],
          message: 'Usá services/transport (backend) o services/window (ventana) en lugar de importar Tauri.',
        }],
      }],
    },
  },
])
