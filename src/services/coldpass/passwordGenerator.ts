/*
 * The backend generates passwords and rates them (`coldpass_generate_password`,
 * `coldpass_rate_password`); these are the shapes it uses.
 */

export interface ColdPassPasswordOptions {
  length: number
  includeUppercase: boolean
  includeNumbers: boolean
  includeSpecialCharacters: boolean
  /** Leaves out characters that are easy to confuse (0 O l 1 I). */
  avoidAmbiguous: boolean
}

/** How strong a password reads: `level` 0 (empty) to 4 («Muy fuerte»). */
export interface ColdPassPasswordRating {
  level: number
  label: string
  hint: string
}

export interface ColdPassGeneratedPassword {
  password: string
  bruteForceSeconds: number
  rating: ColdPassPasswordRating
}
