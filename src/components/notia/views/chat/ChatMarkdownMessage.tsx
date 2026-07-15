import type { ReactNode } from 'react'

interface ChatMarkdownMessageProps {
  source: string
}

type MarkdownBlockType =
  | 'heading'
  | 'paragraph'
  | 'unordered-list'
  | 'ordered-list'
  | 'code'
  | 'blockquote'
  | 'table'
  | 'horizontal-rule'

interface MarkdownTableCell {
  content: string
  align: 'left' | 'center' | 'right' | null
}

interface MarkdownTableRow {
  cells: MarkdownTableCell[]
  isHeader: boolean
}

interface ParsedBlock {
  type: MarkdownBlockType
  level?: number
  lines?: string[]
  items?: MarkdownListItem[]
  language?: string
  content?: string
  rows?: MarkdownTableRow[]
}

interface MarkdownListItem {
  content: string
  children: MarkdownListItem[]
}

const URL_PROTOCOL_PATTERN = /^(https?|mailto|xmpp|tel):/i

function isSafeHref(href: string): boolean {
  return URL_PROTOCOL_PATTERN.test(href.trim())
}

function sanitizeUrl(href: string): string {
  const trimmed = href.trim()
  return isSafeHref(trimmed) ? trimmed : '#'
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let index = 0
  let key = 0

  while (index < text.length) {
    const remaining = text.slice(index)

    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^\s)]+)\)/)
    if (linkMatch) {
      const rawHref = linkMatch[2]
      nodes.push(
        <a
          key={`inline-${key}`}
          href={sanitizeUrl(rawHref)}
          target={isSafeHref(rawHref) ? '_blank' : undefined}
          rel={isSafeHref(rawHref) ? 'noreferrer' : undefined}
          className="notia-chat-markdown-link"
        >
          {linkMatch[1]}
        </a>,
      )
      index += linkMatch[0].length
      key += 1
      continue
    }

    const autoLinkMatch = remaining.match(/^<(https?:\/\/[^\s>]+)>/)
    if (autoLinkMatch) {
      const rawHref = autoLinkMatch[1]
      nodes.push(
        <a
          key={`inline-${key}`}
          href={sanitizeUrl(rawHref)}
          target="_blank"
          rel="noreferrer"
          className="notia-chat-markdown-link"
        >
          {rawHref}
        </a>,
      )
      index += autoLinkMatch[0].length
      key += 1
      continue
    }

    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/)
    if (boldMatch) {
      nodes.push(<strong key={`inline-${key}`}>{renderInlineMarkdown(boldMatch[1])}</strong>)
      index += boldMatch[0].length
      key += 1
      continue
    }

    const italicMatch = remaining.match(/^\*([^*]+)\*/)
    if (italicMatch) {
      nodes.push(<em key={`inline-${key}`}>{renderInlineMarkdown(italicMatch[1])}</em>)
      index += italicMatch[0].length
      key += 1
      continue
    }

    const codeMatch = remaining.match(/^`([^`]+)`/)
    if (codeMatch) {
      nodes.push(<code key={`inline-${key}`}>{codeMatch[1]}</code>)
      index += codeMatch[0].length
      key += 1
      continue
    }

    const nextTokenIndexes = [
      remaining.indexOf('['),
      remaining.indexOf('**'),
      remaining.indexOf('*'),
      remaining.indexOf('`'),
      remaining.indexOf('<'),
    ].filter((candidate) => candidate >= 0)

    const nextIndex = nextTokenIndexes.length > 0 ? Math.min(...nextTokenIndexes) : -1
    const plainText = nextIndex >= 0 ? remaining.slice(0, nextIndex) : remaining
    if (plainText) {
      nodes.push(plainText)
      index += plainText.length
      continue
    }

    nodes.push(remaining[0])
    index += 1
  }

  return nodes
}

function stripLeadingIndent(lines: string[]): string[] {
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0)
  if (nonEmptyLines.length === 0) {
    return lines
  }

  const minIndent = Math.min(...nonEmptyLines.map((line) => {
    const match = line.match(/^(\s*)/)
    return match?.[1].length ?? 0
  }))

  if (minIndent === 0) {
    return lines
  }

  return lines.map((line) => line.slice(minIndent))
}

function parseListBlock(
  lines: string[],
  startIndex: number,
): { items: MarkdownListItem[]; nextIndex: number } {
  const items: MarkdownListItem[] = []
  let index = startIndex

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const trimmedLine = line.trim()
    const listMarkerMatch = trimmedLine.match(/^([-*+]|\d+\.)\s+(.*)$/)
    if (!listMarkerMatch) {
      break
    }

    const itemIndent = line.length - line.trimStart().length
    const contentLines: string[] = [listMarkerMatch[2]]
    index += 1

    while (index < lines.length) {
      const nextLine = lines[index] ?? ''
      const nextTrimmed = nextLine.trim()
      if (!nextTrimmed) {
        index += 1
        continue
      }

      const nextIndent = nextLine.length - nextLine.trimStart().length
      const isSiblingListItem = /^([-*+]|\d+\.)\s+/.test(nextTrimmed)
      const isNestedList = /^([-*+]|\d+\.)\s+/.test(nextTrimmed) && nextIndent > itemIndent

      if (isSiblingListItem && !isNestedList) {
        break
      }

      contentLines.push(nextLine)
      index += 1
    }

    const normalizedContentLines = stripLeadingIndent(contentLines)
    const rootContent = normalizedContentLines[0] ?? ''
    const nestedLines = normalizedContentLines.slice(1)

    let children: MarkdownListItem[] = []
    if (nestedLines.length > 0) {
      const nestedResult = parseListBlock(nestedLines, 0)
      children = nestedResult.items
    }

    items.push({
      content: rootContent,
      children,
    })
  }

  return { items, nextIndex: index }
}

function parseTable(lines: string[], startIndex: number): { block: ParsedBlock; nextIndex: number } | null {
  const headerLine = lines[startIndex]?.trim() ?? ''
  const headerMatch = headerLine.match(/^\|?((?:[^|]*\|)+[^|]*)\|?$/)
  if (!headerMatch) {
    return null
  }

  const separatorIndex = startIndex + 1
  const separatorLine = lines[separatorIndex]?.trim() ?? ''
  const separatorMatch = separatorLine.match(/^\|?((?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*)\|?$/)
  if (!separatorMatch) {
    return null
  }

  const headerCells = headerLine
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())

  const alignments = separatorLine
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => {
      const trimmed = cell.trim()
      const left = trimmed.startsWith(':')
      const right = trimmed.endsWith(':')
      if (left && right) return 'center'
      if (right) return 'right'
      if (left) return 'left'
      return null
    })

  const rows: MarkdownTableRow[] = [
    {
      isHeader: true,
      cells: headerCells.map((content, index) => ({
        content,
        align: alignments[index] ?? null,
      })),
    },
  ]

  let index = separatorIndex + 1
  while (index < lines.length) {
    const rowLine = lines[index]?.trim() ?? ''
    if (!rowLine) {
      break
    }

    const rowMatch = rowLine.match(/^\|?((?:[^|]*\|)+[^|]*)\|?$/)
    if (!rowMatch) {
      break
    }

    const cells = rowLine
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim())

    rows.push({
      isHeader: false,
      cells: cells.map((content, cellIndex) => ({
        content,
        align: alignments[cellIndex] ?? null,
      })),
    })
    index += 1
  }

  return {
    block: { type: 'table', rows },
    nextIndex: index,
  }
}

function parseMarkdownBlocks(source: string): ParsedBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ParsedBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const trimmedLine = line.trim()

    if (!trimmedLine) {
      index += 1
      continue
    }

    const codeFenceMatch = trimmedLine.match(/^```([\w-]+)?\s*$/)
    if (codeFenceMatch) {
      const language = codeFenceMatch[1]?.trim() ?? ''
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index]?.trim().startsWith('```')) {
        codeLines.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      blocks.push({
        type: 'code',
        language,
        content: codeLines.join('\n'),
      })
      continue
    }

    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        content: headingMatch[2],
      })
      index += 1
      continue
    }

    if (/^---\s*$|^\*\*\*\s*$|^___\s*$/.test(trimmedLine)) {
      blocks.push({ type: 'horizontal-rule' })
      index += 1
      continue
    }

    const tableResult = parseTable(lines, index)
    if (tableResult) {
      blocks.push(tableResult.block)
      index = tableResult.nextIndex
      continue
    }

    if (/^>\s?/.test(trimmedLine)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>\s?/.test((lines[index] ?? '').trim())) {
        quoteLines.push((lines[index] ?? '').trim().replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push({
        type: 'blockquote',
        lines: quoteLines,
      })
      continue
    }

    if (/^[-*+]\s+/.test(trimmedLine) || /^\d+\.\s+/.test(trimmedLine)) {
      const isOrdered = /^\d+\.\s+/.test(trimmedLine)
      const { items, nextIndex } = parseListBlock(lines, index)
      blocks.push({
        type: isOrdered ? 'ordered-list' : 'unordered-list',
        items,
      })
      index = nextIndex
      continue
    }

    const paragraphLines: string[] = [line]
    index += 1
    while (index < lines.length) {
      const nextLine = lines[index] ?? ''
      const nextTrimmed = nextLine.trim()
      if (
        !nextTrimmed
        || /^(#{1,6})\s+/.test(nextTrimmed)
        || /^```/.test(nextTrimmed)
        || /^>\s?/.test(nextTrimmed)
        || /^[-*+]\s+/.test(nextTrimmed)
        || /^\d+\.\s+/.test(nextTrimmed)
        || /^---\s*$|^\*\*\*\s*$|^___\s*$/.test(nextTrimmed)
        || /^\|?[^|]+\|/.test(nextTrimmed)
      ) {
        break
      }
      paragraphLines.push(nextLine)
      index += 1
    }
    blocks.push({
      type: 'paragraph',
      lines: paragraphLines,
    })
  }

  return blocks
}

function renderListItems(items: MarkdownListItem[], ordered: boolean): ReactNode {
  const ListTag = ordered ? 'ol' : 'ul'
  return (
    <ListTag>
      {items.map((item, itemIndex) => (
        <li key={`item-${itemIndex}`}>
          {renderInlineMarkdown(item.content)}
          {item.children.length > 0 ? renderListItems(item.children, ordered) : null}
        </li>
      ))}
    </ListTag>
  )
}

export function ChatMarkdownMessage({ source }: ChatMarkdownMessageProps) {
  const blocks = parseMarkdownBlocks(source)

  return (
    <div className="notia-chat-markdown">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const content = renderInlineMarkdown(block.content ?? '')
          const level = Math.min(6, Math.max(1, block.level ?? 2))
          if (level === 1) {
            return <h1 key={`block-${index}`}>{content}</h1>
          }
          if (level === 2) {
            return <h2 key={`block-${index}`}>{content}</h2>
          }
          if (level === 3) {
            return <h3 key={`block-${index}`}>{content}</h3>
          }
          if (level === 4) {
            return <h4 key={`block-${index}`}>{content}</h4>
          }
          if (level === 5) {
            return <h5 key={`block-${index}`}>{content}</h5>
          }
          return <h6 key={`block-${index}`}>{content}</h6>
        }

        if (block.type === 'unordered-list') {
          return (
            <div key={`block-${index}`} className="notia-chat-markdown-list">
              {renderListItems(block.items ?? [], false)}
            </div>
          )
        }

        if (block.type === 'ordered-list') {
          return (
            <div key={`block-${index}`} className="notia-chat-markdown-list">
              {renderListItems(block.items ?? [], true)}
            </div>
          )
        }

        if (block.type === 'code') {
          const language = block.language?.trim()
          return (
            <pre key={`block-${index}`} className="notia-chat-markdown-code">
              {language ? (
                <div className="notia-chat-markdown-code-language">{language}</div>
              ) : null}
              <code>{block.content ?? ''}</code>
            </pre>
          )
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote key={`block-${index}`}>
              {(block.lines ?? []).map((line, lineIndex) => (
                <p key={`quote-${lineIndex}`}>{renderInlineMarkdown(line)}</p>
              ))}
            </blockquote>
          )
        }

        if (block.type === 'table' && block.rows && block.rows.length > 0) {
          return (
            <table key={`block-${index}`} className="notia-chat-markdown-table">
              <thead>
                <tr>
                  {block.rows[0].cells.map((cell, cellIndex) => (
                    <th
                      key={`header-${cellIndex}`}
                      style={cell.align ? { textAlign: cell.align } : undefined}
                    >
                      {renderInlineMarkdown(cell.content)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.slice(1).map((row, rowIndex) => (
                  <tr key={`row-${rowIndex}`}>
                    {row.cells.map((cell, cellIndex) => (
                      <td
                        key={`cell-${rowIndex}-${cellIndex}`}
                        style={cell.align ? { textAlign: cell.align } : undefined}
                      >
                        {renderInlineMarkdown(cell.content)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }

        if (block.type === 'horizontal-rule') {
          return <hr key={`block-${index}`} className="notia-chat-markdown-rule" />
        }

        return (
          <p key={`block-${index}`}>
            {renderInlineMarkdown((block.lines ?? []).join('\n'))}
          </p>
        )
      })}
    </div>
  )
}
