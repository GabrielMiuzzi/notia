import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { ensureLibraryConfigExists, readLibraryConfig, writeLibraryConfig } from './libraryConfig'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const aiPreferences = {
  ollamaUrl: 'https://ollama.com',
  apiKey: 'library-key',
  selectedModel: 'qwen3',
  thinkingEnabled: true,
  thinkingLevel: 'medium' as const,
}

describe('libraryConfig backend client', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it('reads the configuration normalized by the backend by library identity', async () => {
    vi.mocked(invoke).mockResolvedValue({ ok: true, config: { version: 1, ia: aiPreferences } })

    const config = await readLibraryConfig('library-id')

    expect(invoke).toHaveBeenCalledWith('backend_read_library_config', { payload: { libraryId: 'library-id' } })
    expect(config?.ia).toMatchObject(aiPreferences)
  })

  it('returns null when the library has no configuration or it cannot be read', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ok: true, config: null })
    expect(await readLibraryConfig('library-id')).toBeNull()

    vi.mocked(invoke).mockRejectedValueOnce(new Error('ipc'))
    expect(await readLibraryConfig('library-id')).toBeNull()
  })

  it('sends the configuration to the backend without filesystem paths', async () => {
    vi.mocked(invoke).mockResolvedValue({ ok: true, config: {} })

    const result = await writeLibraryConfig('library-id', { version: 1, ia: aiPreferences })

    expect(result).toEqual({ ok: true })
    expect(invoke).toHaveBeenCalledWith('backend_write_library_config', {
      payload: { libraryId: 'library-id', config: { version: 1, ia: aiPreferences } },
    })
  })

  it('reports when the default configuration cannot be written', async () => {
    vi.mocked(invoke).mockResolvedValue({ ok: false, error: 'SAF rechazó la escritura.' })

    await expect(ensureLibraryConfigExists('library-id')).rejects.toThrow('SAF rechazó la escritura.')
  })
})
