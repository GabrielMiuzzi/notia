import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, '..')
const args = process.argv.slice(2)
const isWindows = platform() === 'win32'

const isAndroidCommand = args[0] === 'android'

function resolveAndroidSdkRoot() {
  const candidates = isWindows
    ? [
        process.env.ANDROID_HOME,
        process.env.ANDROID_SDK_ROOT,
        path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk'),
        path.join(homedir(), 'AppData', 'Local', 'Android', 'Sdk')
      ]
    : [
        process.env.ANDROID_HOME,
        process.env.ANDROID_SDK_ROOT,
        '/opt/android-sdk',
        path.join(homedir(), 'Android', 'Sdk')
      ]

  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
}

function resolveAndroidNdkDir(sdkRoot) {
  const direct = [process.env.ANDROID_NDK_HOME, process.env.NDK_HOME].find(
    (candidate) => candidate && existsSync(candidate)
  )
  if (direct) {
    return direct
  }

  if (!sdkRoot) {
    return null
  }

  const ndkRoot = path.join(sdkRoot, 'ndk')
  if (!existsSync(ndkRoot)) {
    return null
  }

  const dirs = readdirSync(ndkRoot)
    .map((entry) => path.join(ndkRoot, entry))
    .filter((entry) => {
      try {
        return statSync(entry).isDirectory()
      } catch {
        return false
      }
    })
    .sort()

  return dirs.at(-1) ?? null
}

function buildEnv() {
  const env = { ...process.env }

  if (!isAndroidCommand) {
    return env
  }

  const sdkRoot = resolveAndroidSdkRoot()
  const ndkDir = resolveAndroidNdkDir(sdkRoot)

  if (!sdkRoot || !ndkDir) {
    return env
  }

  env.ANDROID_HOME = sdkRoot
  env.ANDROID_SDK_ROOT = sdkRoot
  env.NDK_HOME = ndkDir
  env.ANDROID_NDK_HOME = ndkDir

  const toolchainBin = isWindows
    ? path.join(ndkDir, 'toolchains', 'llvm', 'prebuilt', 'windows-x86_64', 'bin')
    : path.join(ndkDir, 'toolchains', 'llvm', 'prebuilt', 'linux-x86_64', 'bin')

  if (existsSync(toolchainBin)) {
    env.PATH = `${toolchainBin}${path.delimiter}${env.PATH ?? ''}`
    const ext = isWindows ? '.cmd' : ''
    env.CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = path.join(toolchainBin, `aarch64-linux-android24-clang${ext}`)
    delete env.CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER
    delete env.CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER
    delete env.CARGO_TARGET_I686_LINUX_ANDROID_LINKER
  }

  if (!env.ANDROID_SERIAL) {
    const adb = isWindows ? 'adb.exe' : 'adb'
    const adbResult = spawnSync(adb, ['devices'], {
      env,
      encoding: 'utf8',
      shell: false
    })
    if (adbResult.status === 0) {
      const devices = adbResult.stdout
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length >= 2 && parts[1] === 'device')
        .map((parts) => parts[0])
      if (devices.length > 0) {
        const physical = devices.find((device) => !device.startsWith('emulator-'))
        env.ANDROID_SERIAL = physical ?? devices[0]
      }
    }
  }

  return env
}

const env = buildEnv()

if (isWindows) {
  const result = spawnSync('npx.cmd', ['tauri', ...args], {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
    shell: false
  })
  process.exit(result.status ?? 1)
}

const shellScript = path.join(__dirname, 'tauri-cli.sh')
const result = spawnSync(shellScript, args, {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
  shell: false
})
process.exit(result.status ?? 1)
