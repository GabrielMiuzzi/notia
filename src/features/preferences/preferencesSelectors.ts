import type { RootState } from '../../store/index'

export const selectTheme = (state: RootState) => state.preferences.theme
export const selectAiSettings = (state: RootState) => state.preferences.aiSettings
export const selectInkMathPreferences = (state: RootState) => state.preferences.inkMathPreferences
export const selectExplorerRefreshIntervalMs = (state: RootState) => state.preferences.explorerRefreshIntervalMs
export const selectTelegramSettings = (state: RootState) => state.preferences.telegramSettings
export const selectQwen3TtsSettings = (state: RootState) => state.preferences.qwen3TtsSettings
export const selectQwen3AsrSettings = (state: RootState) => state.preferences.qwen3AsrSettings
export const selectBackupPreferences = (state: RootState) => state.preferences.backupPreferences
export const selectTaskManagerPublicationPreferences = (state: RootState) => state.preferences.taskManagerPublicationPreferences
