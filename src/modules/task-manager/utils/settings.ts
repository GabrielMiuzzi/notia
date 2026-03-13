import {
  DEFAULT_BOARD_NAME,
  DEFAULT_BOARDS,
  DEFAULT_GROUPS,
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
          activityHoursPerDay: 24,
        }))
        .filter((board) => Boolean(board.name)),
    )
  }

  const parsedBoards = rawBoards
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name.trim().toLowerCase() : '',
      color: typeof item.color === 'string' ? item.color : '#2e6db0',
      activityHoursPerDay: normalizeBoardActivityHours(item.activityHoursPerDay),
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
  const merged = DEFAULT_BOARDS.map((defaultBoard) => ({
    ...(byName.get(defaultBoard.name) ?? defaultBoard),
    activityHoursPerDay: normalizeBoardActivityHours(byName.get(defaultBoard.name)?.activityHoursPerDay ?? defaultBoard.activityHoursPerDay),
  }))
  const additionalBoards = boards.filter((board) => board.name !== DEFAULT_BOARD_NAME)
  return [...merged, ...additionalBoards]
}

function normalizeBoardActivityHours(rawValue: unknown): number {
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed)) {
    return 24
  }

  return Math.min(24, Math.max(0, Number(parsed.toFixed(2))))
}
