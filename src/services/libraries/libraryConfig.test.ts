import { callBackend } from '../transport'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureLibraryConfigExists, readLibraryConfig, writeLibraryConfig } from './libraryConfig'

vi.mock('../transport', () => ({
  callBackend: vi.fn(),
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
    vi.mocked(callBackend).mockReset()
  })

  it('reads the configuration normalized by the backend by library identity', async () => {
    vi.mocked(callBackend).mockResolvedValue({ ok: true, config: { version: 1, ia: aiPreferences } })

    const config = await readLibraryConfig('library-id')

    expect(callBackend).toHaveBeenCalledWith('backend_read_library_config', { payload: { libraryId: 'library-id' } })
    expect(config?.ia).toMatchObject(aiPreferences)
  })

  it('returns null when the library has no configuration or it cannot be read', async () => {
    vi.mocked(callBackend).mockResolvedValueOnce({ ok: true, config: null })
    expect(await readLibraryConfig('library-id')).toBeNull()

    vi.mocked(callBackend).mockRejectedValueOnce(new Error('ipc'))
    expect(await readLibraryConfig('library-id')).toBeNull()
  })

  it('sends the configuration without filesystem paths and returns what the backend stored', async () => {
    vi.mocked(callBackend).mockResolvedValue({ ok: true, config: {} })

    const result = await writeLibraryConfig('library-id', { version: 1, ia: aiPreferences })

    expect(result).toEqual({ ok: true, config: {} })
    expect(callBackend).toHaveBeenCalledWith('backend_write_library_config', {
      payload: { libraryId: 'library-id', config: { version: 1, ia: aiPreferences } },
    })
  })

  it('reports when the default configuration cannot be written', async () => {
    vi.mocked(callBackend).mockResolvedValue({ ok: false, error: 'SAF rechazó la escritura.' })

    await expect(ensureLibraryConfigExists('library-id')).rejects.toThrow('SAF rechazó la escritura.')
  })
})
