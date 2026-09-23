import { invoke } from '@tauri-apps/api/core'

/*
 * The Telegram bot runs in the backend (`telegram_worker.rs`): polling,
 * linking, queue, progress, confirmations and answers. The interface only
 * checks a token before saving it.
 */

export interface TelegramIdentity { id: number; username?: string; displayName: string }

export const checkTelegramBot = (token: string) => invoke<TelegramIdentity>('check_telegram_bot', { payload: { token } })
