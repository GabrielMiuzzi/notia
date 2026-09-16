import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { editTelegramMessage, sendTelegramMessage } from './telegramRuntime'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('telegram native adapter', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it('keeps send and edit payloads typed and returns the native message id', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(42).mockResolvedValueOnce(undefined)

    await expect(sendTelegramMessage('fixture', 17, '<b>estado</b>', [], 'HTML')).resolves.toBe(42)
    await editTelegramMessage('fixture', 17, 42, '<b>actualizado</b>', [], 'HTML')

    expect(invoke).toHaveBeenNthCalledWith(1, 'send_telegram_message', {
      payload: { token: 'fixture', chatId: 17, text: '<b>estado</b>', buttons: [], parseMode: 'HTML' },
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'edit_telegram_message', {
      payload: { token: 'fixture', chatId: 17, messageId: 42, text: '<b>actualizado</b>', buttons: [], parseMode: 'HTML' },
    })
  })

  it('retries an HTML send as plain text when Telegram rejects its entities', async () => {
    vi.mocked(invoke)
      .mockRejectedValueOnce("Bad Request: can't parse entities: Unexpected end tag")
      .mockResolvedValueOnce(43)

    await expect(sendTelegramMessage('fixture', 17, '<b>estado</b> &amp; detalle', [], 'HTML')).resolves.toBe(43)

    expect(invoke).toHaveBeenNthCalledWith(2, 'send_telegram_message', {
      payload: { token: 'fixture', chatId: 17, text: 'estado & detalle', buttons: [], parseMode: undefined },
    })
  })

  it('retries an HTML edit as plain text when Telegram rejects its entities', async () => {
    vi.mocked(invoke)
      .mockRejectedValueOnce("Bad Request: can't parse entities: Unexpected end tag")
      .mockResolvedValueOnce(undefined)

    await expect(editTelegramMessage('fixture', 17, 42, '<b>actualizado</b>', [], 'HTML')).resolves.toBeUndefined()

    expect(invoke).toHaveBeenNthCalledWith(2, 'edit_telegram_message', {
      payload: { token: 'fixture', chatId: 17, messageId: 42, text: 'actualizado', buttons: [], parseMode: undefined },
    })
  })
})
