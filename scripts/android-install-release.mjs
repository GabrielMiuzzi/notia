import { spawnSync } from 'node:child_process'
import { platform } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const isWindows = platform() === 'win32'

const script = isWindows
  ? path.join(__dirname, 'android-install-release-windows.ps1')
  : path.join(__dirname, 'android-install-release.sh')

const command = isWindows ? 'powershell.exe' : script
const args = isWindows
  ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...process.argv.slice(2)]
  : process.argv.slice(2)

const result = spawnSync(command, args, {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  shell: false
})

if (typeof result.status === 'number') {
  process.exit(result.status)
}

process.exit(1)
