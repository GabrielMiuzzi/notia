import { CANCELLED_TASK_INDEX_BASENAME, FINISHED_TASK_INDEX_BASENAME, INDEX_TAG, SUBTASK_TAG, TASK_INDEX_BASENAME, TASK_TAG, TASKS_ROOT_FOLDER } from '../constants/taskManagerConstants'
import type { MarkdownFileDocument, TaskFrontmatter } from '../types/taskManagerTypes'
import { toTaskFrontmatter } from '../utils/guards'

const FRONTMATTER_BLOCK_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export interface ParsedFrontmatter {
  frontmatter: TaskFrontmatter | null
  body: string
  hasFrontmatter: boolean
}

export function parseMarkdownFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(FRONTMATTER_BLOCK_REGEX)
  if (!match) {
    return {
      frontmatter: null,
      body: content,
      hasFrontmatter: false,
    }
  }

  const rawYaml = match[1]
  return {
    frontmatter: toTaskFrontmatter(parseSimpleYaml(rawYaml)),
    body: content.slice(match[0].length),
    hasFrontmatter: true,
  }
}

export function updateMarkdownFrontmatter(content: string, updates: Partial<TaskFrontmatter>): string {
  const parsed = parseMarkdownFrontmatter(content)
  const baseFrontmatter = parsed.frontmatter ?? {}
  const mergedFrontmatter: TaskFrontmatter = {
    ...baseFrontmatter,
    ...updates,
  }

  const serialized = serializeFrontmatter(mergedFrontmatter)
  const body = parsed.body.startsWith('\n') ? parsed.body.slice(1) : parsed.body
  return `${serialized}\n\n${body}`
}

export function syncTaskTypeTags(filePath: string, content: string): string {
  const parsed = parseMarkdownFrontmatter(content)
  const currentTags = normalizeTags(parsed.frontmatter?.tags)
  const classificationTags = new Set([INDEX_TAG, TASK_TAG, SUBTASK_TAG])
  const preservedTags = currentTags.filter((tag) => !classificationTags.has(tag))
  const classificationTag = resolveClassificationTag(filePath)

  return updateMarkdownFrontmatter(content, {
    ...(parsed.frontmatter ?? {}),
    tags: [...preservedTags, classificationTag],
  })
}

export function rebuildTaskChildLinks(files: MarkdownFileDocument[]): Map<string, string[]> {
  const childMap = new Map<string, Set<string>>()

  for (const file of files) {
    const parsed = parseMarkdownFrontmatter(file.content)
    const parentName = normalizeParentReference(parsed.frontmatter?.parent)
    if (!parentName) {
      continue
    }

    const fileName = getBasenameWithoutExtension(file.path)
    const children = childMap.get(parentName) ?? new Set<string>()
    children.add(fileName)
    childMap.set(parentName, children)
  }

  const result = new Map<string, string[]>()
  for (const file of files) {
    const taskName = getBasenameWithoutExtension(file.path)
    const childSet = new Set<string>([
      ...(childMap.get(taskName) ?? []),
      ...(childMap.get(taskName.toLowerCase()) ?? []),
    ])
    childSet.delete(taskName)

    result.set(
      file.path,
      Array.from(childSet)
        .sort((left, right) => left.localeCompare(right))
        .map((childName) => `[[${childName}]]`),
    )
  }

  return result
}

export function normalizeParentReference(parentValue: string | undefined): string {
  const trimmedValue = (parentValue || '').trim()
  if (!trimmedValue) {
    return ''
  }

  const linkMatch = trimmedValue.match(/^\[\[(.+?)\]\]$/)
  const rawReference = (linkMatch ? linkMatch[1] : trimmedValue).trim()
  const withoutAlias = rawReference.split('|')[0].trim()
  const withoutHeading = withoutAlias.split('#')[0].trim()
  const basename = withoutHeading.split('/').pop() ?? withoutHeading
  return basename.replace(/\.md$/i, '').trim()
}

export function parseSimpleYaml(yamlText: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = yamlText.split(/\r?\n/)

  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const keyValueMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!keyValueMatch) {
      index += 1
      continue
    }

    const [, key, rawValue] = keyValueMatch
    const trimmedValue = rawValue.trim()

    if (trimmedValue === '') {
      result[key] = ''
      index += 1
      continue
    }

    if (trimmedValue === '[]') {
      result[key] = []
      index += 1
      continue
    }

    if (trimmedValue.startsWith('[') && trimmedValue.endsWith(']')) {
      const innerValues = trimmedValue.slice(1, -1).trim()
      result[key] = innerValues
        ? innerValues.split(',').map((item) => unquoteYamlValue(item.trim()))
        : []
      index += 1
      continue
    }

    if (trimmedValue === '|') {
      const blockLines: string[] = []
      index += 1
      while (index < lines.length && /^\s+/.test(lines[index])) {
        blockLines.push(lines[index].replace(/^\s+/, ''))
        index += 1
      }
      result[key] = blockLines.join('\n')
      continue
    }

    result[key] = unquoteYamlValue(trimmedValue)
    index += 1
  }

  return result
}

export function serializeFrontmatter(frontmatter: TaskFrontmatter): string {
  const lines = ['---']

  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value === 'undefined') {
      continue
    }

    lines.push(`${key}: ${serializeYamlValue(value)}`)
  }

  lines.push('---')
  return lines.join('\n')
}

function resolveClassificationTag(filePath: string): string {
  const basename = getBasenameWithoutExtension(filePath)
  if (
    basename === TASK_INDEX_BASENAME
    || basename === FINISHED_TASK_INDEX_BASENAME
    || basename === CANCELLED_TASK_INDEX_BASENAME
    || isBoardTaskIndexPath(filePath)
  ) {
    return INDEX_TAG
  }

  if (filePath.includes('/subTasks/')) {
    return SUBTASK_TAG
  }

  return TASK_TAG
}

function isBoardTaskIndexPath(path: string): boolean {
  if (!path.startsWith(`${TASKS_ROOT_FOLDER}/`) || !path.endsWith('.md')) {
    return false
  }

  const relativePath = path.slice(`${TASKS_ROOT_FOLDER}/`.length)
  const segments = relativePath.split('/')
  if (segments.length !== 2) {
    return false
  }

  const [boardName, fileName] = segments
  if (!boardName) {
    return false
  }

  return fileName === `${boardName}TaskIndex.md`
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.replace(/^#/, '').trim())
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    const normalizedValue = value.replace(/^#/, '').trim()
    return normalizedValue ? [normalizedValue] : []
  }

  return []
}

function serializeYamlValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeYamlScalar(item)).join(', ')}]`
  }

  return serializeYamlScalar(value)
}

function serializeYamlScalar(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  const normalizedValue = String(value ?? '')
  return `"${normalizedValue.replace(/"/g, '\\"')}"`
}

function unquoteYamlValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"')
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
  }

  return value
}

function getBasenameWithoutExtension(path: string): string {
  const fileName = path.split('/').pop() ?? path
  return fileName.replace(/\.md$/i, '')
}
