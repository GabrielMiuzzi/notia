import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareAndroidArm64Project } from './android-project.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(scriptDir, '..')
const outputRoot = path.join(projectRoot, 'src-tauri', 'gen', 'android', 'app', 'build', 'outputs', 'apk')
const artifactDir = path.join(projectRoot, 'builds', 'android')
const artifactPath = path.join(artifactDir, 'notia-debug.apk')

prepareAndroidArm64Project(projectRoot)

function findDebugApk(directory) {
  if (!existsSync(directory)) return []
  const matches = []
  for (const entry of readdirSync(directory)) {
    const entryPath = path.join(directory, entry)
    const stats = statSync(entryPath)
    if (stats.isDirectory()) {
      matches.push(...findDebugApk(entryPath))
    } else if (entry.endsWith('.apk') && entry.includes('debug') && !entry.endsWith('-unsigned.apk')) {
      matches.push(entryPath)
    }
  }
  return matches
}

const result = spawnSync(process.execPath, [
  path.join(scriptDir, 'tauri-cli.mjs'),
  'android',
  'build',
  '--apk',
  '--debug',
  '--target',
  'aarch64',
  ...process.argv.slice(2)
], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

const candidates = findDebugApk(outputRoot).sort()
const debugApk = candidates.at(-1)
if (!debugApk) {
  console.error(`[notia] Debug APK not found under ${outputRoot}`)
  process.exit(1)
}

mkdirSync(artifactDir, { recursive: true })
copyFileSync(debugApk, artifactPath)
console.log(`[notia] Debug APK ready: ${artifactPath}`)
