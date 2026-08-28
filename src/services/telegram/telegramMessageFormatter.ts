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
    return `\u0000${index}\u0000`
  })
  return { value: preserved, tags }
}

function restoreTelegramTags(value: string, tags: string[]): string {
  return value.replace(/\u0000(\d+)\u0000/g, (_, index: string) => tags[Number(index)] ?? '')
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

/** Converts common Markdown from the model into Telegram's small HTML subset. */
export function formatTelegramMessage(markdown: string): string {
  const { value: preservedMarkdown, tags } = preserveTelegramTags(markdown)
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
