import {
  CHAT_HISTORY_LIMIT_OPTIONS,
  DEFAULT_BOARD_NAME,
  DEFAULT_BOARDS,
  DEFAULT_CHAT_HISTORY_LIMIT,
  DEFAULT_GROUPS,
  DEFAULT_NETRUNNER_BASE_URL,
} from '../constants/taskManagerConstants'
import { createDefaultPomodoroState, normalizePomodoroState } from '../engines/pomodoroEngine'
import type { Board, Group, TaskManagerSettings } from '../types/taskManagerTypes'
import { isRecord } from './guards'

const FALLBACK_COLORS = ['#d97a1e', '#2e6db0', '#00b894', '#e17055', '#fd79a8', '#636e72']

export function createDefaultTaskManagerSettings(): TaskManagerSettings {
  return {
    activeVaultPath: null,
    boards: [...DEFAULT_BOARDS],
    groups: [...DEFAULT_GROUPS],
    pomodoro: createDefaultPomodoroState(),
    netrunnerBaseUrl: DEFAULT_NETRUNNER_BASE_URL,
    chatHistoryLimit: DEFAULT_CHAT_HISTORY_LIMIT,
    activeTab: DEFAULT_BOARD_NAME,
  }
}

export function normalizeTaskManagerSettings(rawValue: unknown): TaskManagerSettings {
  const defaults = createDefaultTaskManagerSettings()
  if (!isRecord(rawValue)) {
    return defaults
  }

  const boards = normalizeBoards(rawValue.boards)
  const groups = normalizeGroups(rawValue.groups)
  const activeTab = typeof rawValue.activeTab === 'string' && rawValue.activeTab.trim()
    ? rawValue.activeTab.trim().toLowerCase()
    : defaults.activeTab

  return {
    activeVaultPath: typeof rawValue.activeVaultPath === 'string' && rawValue.activeVaultPath.trim()
      ? rawValue.activeVaultPath
      : null,
    boards,
    groups,
    pomodoro: normalizePomodoroState(rawValue.pomodoro),
    netrunnerBaseUrl: normalizeNetrunnerBaseUrl(rawValue.netrunnerBaseUrl),
    chatHistoryLimit: normalizeChatHistoryLimit(rawValue.chatHistoryLimit),
    activeTab,
  }
}

function normalizeBoards(rawBoards: unknown): Board[] {
  if (!Array.isArray(rawBoards) || rawBoards.length === 0) {
    return [...DEFAULT_BOARDS]
  }

  if (rawBoards.every((item) => typeof item === 'string')) {
    return mergeWithDefaultBoards(
      rawBoards
        .map((name, index) => ({
          name: String(name).trim().toLowerCase(),
          color: FALLBACK_COLORS[index % FALLBACK_COLORS.length],
        }))
        .filter((board) => Boolean(board.name)),
    )
  }

  const parsedBoards = rawBoards
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name.trim().toLowerCase() : '',
      color: typeof item.color === 'string' ? item.color : '#2e6db0',
    }))
    .filter((board) => Boolean(board.name))

  return mergeWithDefaultBoards(parsedBoards)
}

function normalizeGroups(rawGroups: unknown): Group[] {
  if (!Array.isArray(rawGroups) || rawGroups.length === 0) {
    return [...DEFAULT_GROUPS]
  }

  if (rawGroups.every((item) => typeof item === 'string')) {
    return rawGroups
      .map((name, index) => ({
        name: String(name).trim(),
        color: FALLBACK_COLORS[index % FALLBACK_COLORS.length],
        board: DEFAULT_BOARD_NAME,
      }))
      .filter((group) => Boolean(group.name))
  }

  return rawGroups
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name.trim() : '',
      color: typeof item.color === 'string' ? item.color : '#2e6db0',
      board: typeof item.board === 'string' && item.board.trim() ? item.board.trim().toLowerCase() : DEFAULT_BOARD_NAME,
    }))
    .filter((group) => Boolean(group.name))
}

function mergeWithDefaultBoards(boards: Board[]): Board[] {
  const byName = new Map(boards.map((board) => [board.name, board]))
  const merged = DEFAULT_BOARDS.map((defaultBoard) => byName.get(defaultBoard.name) ?? defaultBoard)
  const additionalBoards = boards.filter((board) => board.name !== DEFAULT_BOARD_NAME)
  return [...merged, ...additionalBoards]
}

function normalizeNetrunnerBaseUrl(rawValue: unknown): string {
  if (typeof rawValue !== 'string') {
    return DEFAULT_NETRUNNER_BASE_URL
  }

  const normalizedValue = rawValue.trim().replace(/\/+$/, '')
  return normalizedValue || DEFAULT_NETRUNNER_BASE_URL
}

function normalizeChatHistoryLimit(rawValue: unknown): number {
  const limit = Number(rawValue)
  if (!Number.isInteger(limit)) {
    return DEFAULT_CHAT_HISTORY_LIMIT
  }

  return CHAT_HISTORY_LIMIT_OPTIONS.includes(limit as 10 | 20 | 50 | 100)
    ? limit
    : DEFAULT_CHAT_HISTORY_LIMIT
}
