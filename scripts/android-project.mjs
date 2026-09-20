import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ARM64_GRADLE_PROPERTIES = [
  'abiList=arm64-v8a',
  'archList=arm64',
  'targetList=aarch64'
]

export function prepareAndroidArm64Project(projectRoot) {
  const androidProject = path.join(projectRoot, 'src-tauri', 'gen', 'android')
  if (!existsSync(androidProject)) return

  const rustPlugin = path.join(
    androidProject,
    'buildSrc',
    'src',
    'main',
    'java',
    'com',
    'gabriel',
    'notia',
    'kotlin',
    'RustPlugin.kt'
  )
  if (existsSync(rustPlugin)) {
    const pluginSource = readFileSync(rustPlugin, 'utf8')
      .replace(
        'val defaultAbiList = listOf("arm64-v8a", "armeabi-v7a", "x86", "x86_64");',
        'val defaultAbiList = listOf("arm64-v8a");'
      )
      .replace(
        'val defaultArchList = listOf("arm64", "arm", "x86", "x86_64");',
        'val defaultArchList = listOf("arm64");'
      )
      .replace(
        'listOf("aarch64", "armv7", "i686", "x86_64")',
        'listOf("aarch64")'
      )
    writeFileSync(rustPlugin, pluginSource)
  }

  const gradleProperties = path.join(androidProject, 'gradle.properties')
  const currentProperties = existsSync(gradleProperties)
    ? readFileSync(gradleProperties, 'utf8').replace(/\s*$/, '')
    : ''
  const withoutPreviousAbiSettings = currentProperties
    .split(/\r?\n/)
    .filter((line) => !/^(abiList|archList|targetList)=/.test(line))
    .join('\n')
    .replace(/\s*$/, '')
  writeFileSync(
    gradleProperties,
    `${withoutPreviousAbiSettings}\n\n# Notia development targets the connected ARM64 device only.\n${ARM64_GRADLE_PROPERTIES.join('\n')}\n`
  )

  // Tauri copies configured resources into this generated directory but does
  // not remove files that disappeared from a narrower platform configuration.
  // Clearing the generated assets avoids packaging desktop-only model files.
  rmSync(path.join(androidProject, 'app', 'src', 'main', 'assets'), {
    recursive: true,
    force: true
  })
}
