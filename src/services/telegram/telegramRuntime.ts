import { invoke } from '@tauri-apps/api/core'

export interface TelegramIdentity { id: number; username?: string; displayName: string }
export interface TelegramAudio {
  fileId: string; duration: number; mimeType?: string; fileSize?: number
}
export interface TelegramPhoto {
  fileId: string; fileSize?: number; width: number; height: number
}
export interface TelegramDownloadedPhoto {
  fileId: string; mimeType: string; base64: string
}
export interface TelegramUpdate {
  updateId: number; chatId: number; user: TelegramIdentity; messageId?: number; text?: string
  audio?: TelegramAudio
  photo?: TelegramPhoto
  callbackQueryId?: string; callbackData?: string
}
export interface TelegramButton { label: string; data: string }

export const checkTelegramBot = (token: string) => invoke<TelegramIdentity>('check_telegram_bot', { payload: { token } })
export const pollTelegramUpdates = (token: string, offset: number) => invoke<TelegramUpdate[]>('poll_telegram_updates', { payload: { token, offset } })
export const sendTelegramMessage = (
  token: string,
  chatId: number,
  text: string,
  buttons: TelegramButton[] = [],
  parseMode?: 'HTML',
) => invoke<void>('send_telegram_message', { payload: { token, chatId, text, buttons, parseMode } })
export const answerTelegramCallback = (token: string, callbackQueryId: string) =>
  invoke<void>('answer_telegram_callback', { payload: { token, callbackQueryId } })
export const transcribeTelegramAudio = (token: string, audio: TelegramAudio) =>
  invoke<string>('transcribe_telegram_audio', { payload: { token, audio } })
export const downloadTelegramPhoto = (token: string, photo: TelegramPhoto) =>
  invoke<TelegramDownloadedPhoto>('download_telegram_photo', { payload: { token, photo } })
