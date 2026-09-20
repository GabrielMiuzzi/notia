import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareAndroidArm64Project } from './android-project.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, '..')
prepareAndroidArm64Project(projectRoot)
const command = process.execPath
const args = [
  path.join(__dirname, 'tauri-cli.mjs'),
  'android',
  'dev',
  '--open',
  ...process.argv.slice(2)
]

const result = spawnSync(command, args, {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false
})

process.exit(result.status ?? 1)
