import { spawnSync } from 'node:child_process'
import { platform } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const isWindows = platform() === 'win32'

const command = isWindows ? 'powershell.exe' : path.join(__dirname, 'tauri-cli.sh')
const args = isWindows
  ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'android-dev-windows.ps1'), ...process.argv.slice(2)]
  : ['android', 'dev', '--open', ...process.argv.slice(2)]

const result = spawnSync(command, args, {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  shell: false
})

process.exit(result.status ?? 1)
