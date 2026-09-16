import { invoke } from '@tauri-apps/api/core'

export interface TelegramIdentity { id: number; username?: string; displayName: string }
export interface TelegramAudio {
  fileId: string; duration: number; mimeType?: string; fileSize?: number
}
export interface TelegramPhoto {
  fileId: string; fileSize?: number; width: number; height: number
}
export interface TelegramDocument {
  fileId: string; fileName?: string; mimeType?: string; fileSize?: number
}
export interface TelegramDownloadedPhoto {
  fileId: string; mimeType: string; base64: string
}
export interface TelegramDownloadedDocument {
  fileId: string; fileName: string; mimeType: string; extractedContent: string
  base64?: string
}
export interface TelegramUpdate {
  updateId: number; chatId: number; user: TelegramIdentity; messageId?: number; text?: string
  audio?: TelegramAudio
  photo?: TelegramPhoto
  document?: TelegramDocument
  callbackQueryId?: string; callbackData?: string
  chatType?: string
}
export interface TelegramButton { label: string; data: string }

function isTelegramEntityParseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return message.toLowerCase().includes("can't parse entities")
}

function telegramHtmlToPlainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

export const checkTelegramBot = (token: string) => invoke<TelegramIdentity>('check_telegram_bot', { payload: { token } })
export const pollTelegramUpdates = (token: string, offset: number) => invoke<TelegramUpdate[]>('poll_telegram_updates', { payload: { token, offset } })
export const sendTelegramMessage = async (
  token: string,
  chatId: number,
  text: string,
  buttons: TelegramButton[] = [],
  parseMode?: 'HTML',
) => {
  const payload = { token, chatId, text, buttons, parseMode }
  try {
    return await invoke<number>('send_telegram_message', { payload })
  } catch (error) {
    if (parseMode !== 'HTML' || !isTelegramEntityParseError(error)) throw error
    return invoke<number>('send_telegram_message', {
      payload: { ...payload, text: telegramHtmlToPlainText(text), parseMode: undefined },
    })
  }
}
export const editTelegramMessage = async (
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  buttons: TelegramButton[] = [],
  parseMode?: 'HTML',
) => {
  const payload = { token, chatId, messageId, text, buttons, parseMode }
  try {
    return await invoke<void>('edit_telegram_message', { payload })
  } catch (error) {
    if (parseMode !== 'HTML' || !isTelegramEntityParseError(error)) throw error
    return invoke<void>('edit_telegram_message', {
      payload: { ...payload, text: telegramHtmlToPlainText(text), parseMode: undefined },
    })
  }
}
export const answerTelegramCallback = (token: string, callbackQueryId: string) =>
  invoke<void>('answer_telegram_callback', { payload: { token, callbackQueryId } })
export const transcribeTelegramAudio = (token: string, audio: TelegramAudio) =>
  invoke<string>('transcribe_telegram_audio', { payload: { token, audio } })
export const downloadTelegramPhoto = (token: string, photo: TelegramPhoto) =>
  invoke<TelegramDownloadedPhoto>('download_telegram_photo', { payload: { token, photo } })
export const extractTelegramPdf = (token: string, document: TelegramDocument) =>
  invoke<TelegramDownloadedDocument>('extract_telegram_pdf', { payload: { token, document } })
