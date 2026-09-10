const TASK_COMMENT_LOCALE = 'es-AR'

/**
 * Appends one comment without interpreting its Markdown body. The caller is
 * responsible for validating the comment length before it reaches this pure
 * transformation.
 */
export function appendTaskComment(
  content: string,
  comment: string,
  timestamp: Date = new Date(),
): string {
  const timestampLabel = timestamp.toLocaleString(TASK_COMMENT_LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace(',', '')

  return `${content.trimEnd()}\n\n## Comentario - ${timestampLabel}\n${comment}\n`
}
