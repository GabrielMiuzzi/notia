/** Telegram bot of the library, stored in its configuration. The backend
 * normalizes it and its worker (`telegram_worker.rs`) runs the bot.
 * `autonomousAgent` lets the agent write to the Owner by itself when new
 * mail arrives (`agent_autonomy.rs`); the hourly review is an AI action. */
export interface TelegramPreferences {
  enabled: boolean
  botToken: string
  autonomousAgent: boolean
}

export const DEFAULT_TELEGRAM_PREFERENCES: TelegramPreferences = {
  enabled: false,
  botToken: '',
  autonomousAgent: true,
}
