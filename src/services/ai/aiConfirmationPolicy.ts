import type { MutationPreview } from '../../types/ai/agentContracts'

/**
 * High-impact mutations deserve a second, explicit acknowledgement. The first
 * confirmation may include selected hunks; the second one confirms the risk,
 * not a different patch.
 */
export function requiresReinforcedAiConfirmation(
  preview: Pick<MutationPreview, 'risk' | 'documents'> | null | undefined,
  force = false,
): boolean {
  if (force) return true
  if (!preview) return false
  return preview.risk === 'critical' || (preview.risk === 'high' && preview.documents.length > 1)
}
