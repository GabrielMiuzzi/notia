import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
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

/** Debug APKs under `directory` (in a `debug` folder), newest first. */
function findDebugApks(directory) {
  if (!existsSync(directory)) return []
  const matches = []
  for (const entry of readdirSync(directory)) {
    const entryPath = path.join(directory, entry)
    const stats = statSync(entryPath)
    if (stats.isDirectory()) {
      matches.push(...findDebugApks(entryPath))
    } else if (entry.endsWith('.apk') && path.basename(directory) === 'debug' && !entry.endsWith('-unsigned.apk')) {
      matches.push({ path: entryPath, modified: stats.mtimeMs })
    }
  }
  return matches.sort((left, right) => right.modified - left.modified)
}

// Only the APK of this build may be copied: earlier debug APKs go first,
// and Gradle packages the new one again.
for (const stale of findDebugApks(outputRoot)) rmSync(stale.path, { force: true })

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

const debugApk = findDebugApks(outputRoot)[0]
if (!debugApk) {
  console.error(`[notia] This build made no debug APK under ${outputRoot}; an older one is never copied.`)
  process.exit(1)
}

mkdirSync(artifactDir, { recursive: true })
copyFileSync(debugApk.path, artifactPath)
console.log(`[notia] Debug APK ready: ${artifactPath} (from ${debugApk.path})`)
