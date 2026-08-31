import { afterEach, describe, expect, it, vi } from 'vitest'
import { notiaLog, TELEGRAM_AI_DIAGNOSTIC_MODULE } from './notiaLogger'

describe('notiaLog', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})

  afterEach(() => {
    consoleError.mockClear()
    consoleInfo.mockClear()
  })

  it('silences routine, warning and performance messages', () => {
    notiaLog('test', 'routine', undefined, 'info')
    notiaLog('test', 'warning', undefined, 'warn')
    notiaLog('test', 'measurement', undefined, 'perf')

    expect(consoleError).not.toHaveBeenCalled()
    expect(consoleInfo).not.toHaveBeenCalled()
  })

  it('keeps the Telegram AI diagnostic trace visible', () => {
    notiaLog(TELEGRAM_AI_DIAGNOSTIC_MODULE, 'ollama round started', { round: 1 }, 'info')

    expect(consoleInfo).toHaveBeenCalledWith('[notia:telegram-ai] ollama round started round=1')
  })

  it('keeps errors visible', () => {
    notiaLog('test', 'failed', { operation: 'save' }, 'error')

    expect(consoleError).toHaveBeenCalledWith('[notia:test] failed operation=save')
  })
})
