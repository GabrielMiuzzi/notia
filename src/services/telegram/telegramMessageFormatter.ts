const TELEGRAM_TAG_PATTERN = /<\/?(?:b|i|u|s|code|pre)>|<a href="(?:https?|mailto):[^"<>]+">|<\/a>/gi

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function preserveTelegramTags(value: string): { value: string; tags: string[] } {
  const tags: string[] = []
  const preserved = value.replace(TELEGRAM_TAG_PATTERN, (tag) => {
    const index = tags.push(tag) - 1
    return `\uE000${index}\uE001`
  })
  return { value: preserved, tags }
}

function restoreTelegramTags(value: string, tags: string[]): string {
  return value.replace(/\uE000(\d+)\uE001/g, (_, index: string) => tags[Number(index)] ?? '')
}

function formatInlineMarkdown(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\(((?:https?|mailto):[^\s)]+)\)/gi, '<a href="$2">$1</a>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n]+)__/g, '<b>$1</b>')
    .replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>')
}

function normalizeTelegramBlockMarkup(value: string): string {
  const fencedParts = value.split(/(```[\s\S]*?```)/g)
  return fencedParts.map((part, index) => {
    if (index % 2 === 1) return part
    return part
      .replace(/\s*\\?<br\s*\/?>\s*/gi, '\n')
      .replace(/\s*\\?<\/?(?:p|div)\b[^>]*>\s*/gi, '\n')
      .replace(/\s*\\?<h[1-6]\b[^>]*>\s*/gi, '\n### ')
      .replace(/\s*\\?<\/h[1-6]>\s*/gi, '\n')
      .replace(/\s*\\?<\/?(?:ul|ol)\b[^>]*>\s*/gi, '\n')
      .replace(/\s*\\?<li\b[^>]*>\s*/gi, '\n- ')
      .replace(/\s*\\?<\/li>\s*/gi, '\n')
      .replace(/\s*\\?<strong\b[^>]*>\s*/gi, '**')
      .replace(/\s*\\?<\/strong>\s*/gi, '**')
      .replace(/\s*\\?<em\b[^>]*>\s*/gi, '*')
      .replace(/\s*\\?<\/em>\s*/gi, '*')
  }).join('')
}

/** Converts common Markdown from the model into Telegram's small HTML subset. */
export function formatTelegramMessage(markdown: string): string {
  const normalizedMarkdown = normalizeTelegramBlockMarkup(markdown)
    .replace(/\\(<\/?(?:b|i|u|s|code|pre)>|<a href="(?:https?|mailto):[^"<>]+">|<\/a>)/gi, '$1')
  const { value: preservedMarkdown, tags } = preserveTelegramTags(normalizedMarkdown)
  const escaped = escapeHtml(preservedMarkdown)
  const withCodeBlocks = escaped.replace(/```(?:[^\n]*)\n([\s\S]*?)```/g, '<pre>$1</pre>')
  const formattedLines = withCodeBlocks.split('\n').map((line) => {
    const heading = line.match(/^\s*#{1,6}\s*(.*)$/)
    if (heading) return `<b>${formatInlineMarkdown(heading[1] ?? '')}</b>`

    const unorderedItem = line.match(/^(\s*)[-*+]\s+(.*)$/)
    if (unorderedItem) return `${unorderedItem[1] ?? ''}• ${formatInlineMarkdown(unorderedItem[2] ?? '')}`

    return formatInlineMarkdown(line)
  }).join('\n')
  return restoreTelegramTags(formattedLines, tags)
}
