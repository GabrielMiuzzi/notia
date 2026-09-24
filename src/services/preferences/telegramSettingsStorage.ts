/** Telegram bot of the library, stored in its configuration. The backend
 * normalizes it and its worker (`telegram_worker.rs`) runs the bot. */
export interface TelegramPreferences {
  enabled: boolean
  botToken: string
}

export const DEFAULT_TELEGRAM_PREFERENCES: TelegramPreferences = {
  enabled: false,
  botToken: '',
}
