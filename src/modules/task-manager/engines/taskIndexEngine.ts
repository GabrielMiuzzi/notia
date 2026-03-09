import {
  CANCELLED_TASK_INDEX_BASENAME,
  CANCELLED_TASKS_FOLDER,
  DEFAULT_BOARD_NAME,
  FINISHED_TASK_INDEX_BASENAME,
  FINISHED_TASKS_FOLDER,
  INDEX_TAG,
  TASK_INDEX_BASENAME,
  TASKS_ROOT_FOLDER,
} from '../constants/taskManagerConstants'

const BOARD_TASK_INDEX_SUFFIX = 'TaskIndex'

export const ROOT_TASK_INDEX_PATH = `${TASKS_ROOT_FOLDER}/${TASK_INDEX_BASENAME}.md`
export const FINISHED_TASK_INDEX_PATH = `${FINISHED_TASKS_FOLDER}/${FINISHED_TASK_INDEX_BASENAME}.md`
export const CANCELLED_TASK_INDEX_PATH = `${CANCELLED_TASKS_FOLDER}/${CANCELLED_TASK_INDEX_BASENAME}.md`

export function getBoardTaskIndexBasename(boardName: string): string {
  const normalized = normalizeBoardName(boardName)
  return `${normalized}${BOARD_TASK_INDEX_SUFFIX}`
}

export function getBoardTaskIndexPath(boardName: string): string {
  const normalized = normalizeBoardName(boardName)
  return `${TASKS_ROOT_FOLDER}/${normalized}/${getBoardTaskIndexBasename(normalized)}.md`
}

export function buildRootTaskIndexContent(boardNames: string[]): string {
  const normalizedBoardNames = Array.from(
    new Set(boardNames.map((boardName) => normalizeBoardName(boardName))),
  )

  if (!normalizedBoardNames.includes(DEFAULT_BOARD_NAME)) {
    normalizedBoardNames.unshift(DEFAULT_BOARD_NAME)
  }

  const boardLinks = normalizedBoardNames
    .map((boardName) => `[[${getBoardTaskIndexBasename(boardName)}]]`)
    .sort((left, right) => left.localeCompare(right))

  const defaultLink = `[[${getBoardTaskIndexBasename(DEFAULT_BOARD_NAME)}]]`
  const orderedLinks = [
    defaultLink,
    ...boardLinks.filter((link) => link !== defaultLink),
    `[[${FINISHED_TASK_INDEX_BASENAME}]]`,
    `[[${CANCELLED_TASK_INDEX_BASENAME}]]`,
  ]

  return buildIndexContent(orderedLinks)
}

export function buildBoardTaskIndexContent(taskNames: string[]): string {
  const links = taskNames
    .map((taskName) => `[[${taskName}]]`)
    .sort((left, right) => left.localeCompare(right))

  return buildIndexContent(links)
}

export function buildIndexContent(lines: string[]): string {
  const bodyLines = lines.flatMap((line) => [line, ''])
  return ['---', `tags: [${INDEX_TAG}]`, '---', '', ...bodyLines].join('\n')
}

function normalizeBoardName(boardName: string): string {
  const normalized = boardName.trim().toLowerCase()
  return normalized || DEFAULT_BOARD_NAME
}
