import { invoke } from '@tauri-apps/api/core'

export interface TelegramIdentity { id: number; username?: string; displayName: string }
export interface TelegramUpdate {
  updateId: number; chatId: number; user: TelegramIdentity; messageId?: number; text?: string
  callbackQueryId?: string; callbackData?: string
}
export interface TelegramButton { label: string; data: string }

export const checkTelegramBot = (token: string) => invoke<TelegramIdentity>('check_telegram_bot', { payload: { token } })
export const pollTelegramUpdates = (token: string, offset: number) => invoke<TelegramUpdate[]>('poll_telegram_updates', { payload: { token, offset } })
export const sendTelegramMessage = (token: string, chatId: number, text: string, buttons: TelegramButton[] = []) =>
  invoke<void>('send_telegram_message', { payload: { token, chatId, text, buttons } })
export const answerTelegramCallback = (token: string, callbackQueryId: string) =>
  invoke<void>('answer_telegram_callback', { payload: { token, callbackQueryId } })
