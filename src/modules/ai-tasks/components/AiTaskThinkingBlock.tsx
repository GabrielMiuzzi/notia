import { useLayoutEffect, useRef } from 'react'
import { Brain } from 'lucide-react'
import { ChatMarkdownMessage } from '../../../components/notia/views/chat/ChatMarkdownMessage'
import type { AiTaskThinking } from '../types/aiTasksTypes'

/** El thinking de la fase en curso, siguiendo el final del texto mientras llega. */
export function AiTaskThinkingBlock({ thinking }: { thinking: AiTaskThinking }) {
  const contentRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const container = contentRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [thinking.text])

  return (
    <section className="ait-section ait-thinking" data-phase={thinking.phase} aria-labelledby="ait-thinking-title">
      <h3 id="ait-thinking-title"><Brain size={14} aria-hidden="true" /> {thinking.label}</h3>
      {thinking.text.trim() ? (
        <div ref={contentRef} className="ait-thinking__content" aria-live="polite" tabIndex={0}>
          <ChatMarkdownMessage source={thinking.text} />
        </div>
      ) : (
        <div className="ait-thinking__dots" role="status" aria-label="Pensando">
          <span />
          <span />
          <span />
        </div>
      )}
    </section>
  )
}
