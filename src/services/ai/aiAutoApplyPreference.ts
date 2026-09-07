import type { MutationPreview } from '../../types/ai/agentContracts'

const STORAGE_PREFIX = 'notia:ai-auto-apply-low-risk:v1:'

function storageKey(libraryId: string): string {
  return `${STORAGE_PREFIX}${libraryId}`
}

export function loadAutoApplyLowRiskPreference(libraryId: string): boolean {
  if (typeof window === 'undefined' || !libraryId.trim()) return false
  try {
    return window.localStorage.getItem(storageKey(libraryId)) === '1'
  } catch {
    return false
  }
}

export function saveAutoApplyLowRiskPreference(libraryId: string, enabled: boolean): void {
  if (typeof window === 'undefined' || !libraryId.trim()) return
  try {
    if (enabled) window.localStorage.setItem(storageKey(libraryId), '1')
    else window.localStorage.removeItem(storageKey(libraryId))
  } catch {
    // Confirmation remains the safe fallback when storage is unavailable.
  }
}

export function shouldAutoApplyLowRiskPreview(
  preview: (Pick<MutationPreview, 'risk' | 'allowedActions'> & { hunks: readonly { id: string }[] }) | null | undefined,
  enabled: boolean,
): boolean {
  return enabled
    && preview?.risk === 'low'
    && preview.allowedActions.includes('apply-all')
    && preview.hunks.length > 0
}
