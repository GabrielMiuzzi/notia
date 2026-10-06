import { AlertCircle, Check, LoaderCircle } from 'lucide-react'
import type { MeetingReview } from '../../../../services/meeting/meetingTypes'

const STAGE_TEXT: Record<NonNullable<MeetingReview['stage']>, string> = {
  cleanup: 'La IA está ordenando la transcripción…',
  names: 'La IA está buscando los nombres de los hablantes…',
}

/** What the AI review of the finished meeting is doing, or what it did. */
export function MeetingReviewNotice({ review }: { review: MeetingReview }) {
  if (review.stage) {
    return (
      <p className="notia-meeting-review" role="status">
        <LoaderCircle size={14} className="notia-meeting-review-spin" aria-hidden="true" />
        {STAGE_TEXT[review.stage]}
      </p>
    )
  }
  if (review.error) {
    return (
      <p className="notia-meeting-review notia-meeting-review--error" role="status">
        <AlertCircle size={14} aria-hidden="true" />
        El repaso con IA no terminó: {review.error}
      </p>
    )
  }
  if (!review.cleaned && review.named === 0) return null
  const parts = [
    review.cleaned ? 'Transcripción ordenada con IA' : null,
    review.named > 0 ? `${review.named} ${review.named === 1 ? 'hablante nombrado' : 'hablantes nombrados'} por la conversación` : null,
  ].filter(Boolean)
  return (
    <p className="notia-meeting-review notia-meeting-review--done" role="status">
      <Check size={14} aria-hidden="true" />
      {parts.join(' · ')}
    </p>
  )
}
