import type { ReactNode } from 'react'

interface ChatMarkdownMessageProps {
  source: string
}

interface ParsedBlock {
  type: 'heading' | 'paragraph' | 'unordered-list' | 'ordered-list' | 'code' | 'blockquote'
  level?: number
  lines?: string[]
  items?: string[]
  language?: string
  content?: string
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let index = 0
  let key = 0

  while (index < text.length) {
    const remaining = text.slice(index)

    const linkMatch = remaining.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/)
    if (linkMatch) {
      nodes.push(
        <a
          key={`inline-${key}`}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
          className="notia-chat-markdown-link"
        >
          {linkMatch[1]}
        </a>,
      )
      index += linkMatch[0].length
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

    if (/^[-*+]\s+/.test(trimmedLine)) {
      const items: string[] = []
      while (index < lines.length && /^[-*+]\s+/.test((lines[index] ?? '').trim())) {
        items.push((lines[index] ?? '').trim().replace(/^[-*+]\s+/, ''))
        index += 1
      }
      blocks.push({
        type: 'unordered-list',
        items,
      })
      continue
    }

    if (/^\d+\.\s+/.test(trimmedLine)) {
      const items: string[] = []
      while (index < lines.length && /^\d+\.\s+/.test((lines[index] ?? '').trim())) {
        items.push((lines[index] ?? '').trim().replace(/^\d+\.\s+/, ''))
        index += 1
      }
      blocks.push({
        type: 'ordered-list',
        items,
      })
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
            <ul key={`block-${index}`}>
              {(block.items ?? []).map((item, itemIndex) => (
                <li key={`item-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          )
        }

        if (block.type === 'ordered-list') {
          return (
            <ol key={`block-${index}`}>
              {(block.items ?? []).map((item, itemIndex) => (
                <li key={`item-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
              ))}
            </ol>
          )
        }

        if (block.type === 'code') {
          return (
            <pre key={`block-${index}`} className="notia-chat-markdown-code">
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

        return (
          <p key={`block-${index}`}>
            {renderInlineMarkdown((block.lines ?? []).join('\n'))}
          </p>
        )
      })}
    </div>
  )
}
