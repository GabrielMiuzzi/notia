import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readLibraryConfig, writeLibraryConfig } from './libraryConfig'
import { createDirectory, pathExists, readTextFile, writeTextFile } from '../files/filesystemEngine'

vi.mock('../files/filesystemEngine', () => ({
  createDirectory: vi.fn().mockResolvedValue({ ok: true }),
  pathExists: vi.fn().mockResolvedValue(false),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn().mockResolvedValue({ ok: true }),
}))

const aiPreferences = {
  ollamaUrl: 'https://ollama.com',
  apiKey: 'secret-must-not-enter-library-config',
  selectedModel: 'qwen3',
  thinkingEnabled: true,
  thinkingLevel: 'medium' as const,
}

describe('libraryConfig AI preferences', () => {
  beforeEach(() => {
    vi.mocked(readTextFile).mockReset()
    vi.mocked(writeTextFile).mockReset().mockResolvedValue({ ok: true })
    vi.mocked(pathExists).mockReset().mockResolvedValue(false)
    vi.mocked(createDirectory).mockReset().mockResolvedValue({ ok: true })
  })

  it('hydrates an API key from the library configuration', async () => {
    vi.mocked(readTextFile).mockResolvedValue({
      ok: true,
      content: JSON.stringify({ version: 1, ia: aiPreferences }),
    })

    const config = await readLibraryConfig('library')

    expect(config?.ia).toMatchObject(aiPreferences)
  })

  it('writes the API key to the library configuration', async () => {
    await writeLibraryConfig('library', { version: 1, ia: aiPreferences })

    const content = vi.mocked(writeTextFile).mock.calls.at(-1)?.[1]
    expect(typeof content).toBe('string')
    expect(JSON.parse(content as string).ia).toMatchObject(aiPreferences)
  })

  it('hydrates access-user hashes from the active library configuration', async () => {
    vi.mocked(readTextFile).mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        version: 1,
        taskManagerPublication: {
          accessUsers: [{ username: 'Ana', passwordHash: '$notia-pbkdf2-sha256$v=1$i=210000$salt$hash' }],
        },
      }),
    })

    const config = await readLibraryConfig('library')

    expect(config?.taskManagerPublication?.accessUsers).toEqual([
      { username: 'Ana', passwordHash: '$notia-pbkdf2-sha256$v=1$i=210000$salt$hash' },
    ])
  })
})
