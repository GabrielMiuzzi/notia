import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('Tauri ignore rules cover Gradle and native build artifacts at any depth', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'notia-watcher-test-'))
  try {
    execFileSync('git', ['init', '--quiet', directory])
    copyFileSync(new URL('../src-tauri/.taurignore', import.meta.url), path.join(directory, '.gitignore'))
    const ignored = [
      'gen/android/.gradle/8.14.3/fileChanges/last-build.bin',
      'gen/android/build/',
      'gen/android/buildSrc/.gradle/8.14.3/executionHistory/executionHistory.lock',
      'gen/android/app/build/intermediates/output.bin',
      'gen/android/.kotlin/session.bin',
      'gen/android/app/.cxx/cache.bin',
      'gen/android/app/.externalNativeBuild/output.bin',
      'vendor/qwen3-tts.cpp/build/',
      'vendor/qwen3-tts.cpp/ggml/build/bin/ggml.dll',
    ]
    const watched = [
      'src/lib.rs', 'build.rs', 'Cargo.toml', 'tauri.conf.json',
      'gen/android/build.gradle.kts',
      'gen/android/app/src/main/AndroidManifest.xml',
      'gen/android/app/src/main/java/com/gabriel/notia/LibraryDatabasePlugin.kt',
      'gen/android/app/src/main/java/com/gabriel/notia/AiBridgePlugin.kt',
      'vendor/qwen3-tts.cpp/CMakeLists.txt',
      'vendor/qwen3-tts.cpp/src/gguf_loader.cpp',
    ]
    // Tauri specifies gitignore syntax; live watcher verification complements this contract test.
    const actual = execFileSync('git', [
      '-C', directory, '-c', 'core.excludesFile=', 'check-ignore', '--no-index', '--stdin',
    ], { input: [...ignored, ...watched].join('\n'), encoding: 'utf8' }).trim().split(/\r?\n/)
    assert.deepEqual(actual, ignored)
  } finally {
    const resolved = realpathSync(directory)
    assert.equal(path.dirname(resolved).toLowerCase(), realpathSync(tmpdir()).toLowerCase())
    assert.ok(path.basename(resolved).startsWith('notia-watcher-test-'))
    rmSync(resolved, { recursive: true })
  }
})
