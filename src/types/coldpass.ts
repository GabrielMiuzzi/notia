/** A replaced password; `replacedAt` (Unix ms) is missing for old vaults. */
export interface ColdPassPasswordRecord {
  password: string
  replacedAt?: number | null
}

export interface ColdPassEntry {
  id: string
  name: string
  website: string
  username: string
  secondaryUsername: string
  password: string
  notes: string
  /** Newest first. The backend keeps it; the form never edits it. */
  passwordHistory: ColdPassPasswordRecord[]
  /** When the current password was set (Unix ms), when known. */
  passwordChangedAt?: number | null
}

/** Health of the current password, decided by the backend. */
export type ColdPassHealth = 'strong' | 'weak' | 'old'

/** A credential as the vault view shows it. */
export interface ColdPassEntryView extends ColdPassEntry {
  health: ColdPassHealth
}
