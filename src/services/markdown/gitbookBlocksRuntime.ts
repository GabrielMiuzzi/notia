import { callBackend } from '../transport'

/*
 * What the GitBook blocks of a note resolve to in its library. Rust reads the
 * variables (`vars:` of the note, `.gitbook/vars.yaml` of the library),
 * evaluates expressions and conditions, and resolves page links, files,
 * images and reusable content relative to the note.
 */

export type GitbookConditionState = 'satisfied' | 'notSatisfied' | 'dependsOnReader' | 'invalid'

export interface GitbookExpressionResult {
  expression: string
  value: string | null
  dependsOnReader: boolean
  error: string | null
}

export interface GitbookConditionResult {
  expression: string
  state: GitbookConditionState
}

export interface GitbookReferenceResult {
  reference: string
  kind: 'external' | 'library' | 'invalid'
  /** Web address, or the library file as the explorer shows it. */
  target: string | null
  exists: boolean
  title: string | null
}

export interface GitbookIncludeResult {
  reference: string
  target: string | null
  title: string | null
  markdown: string | null
  truncated: boolean
  error: string | null
}

export interface GitbookBlocksRequest {
  expressions: string[]
  conditions: string[]
  references: string[]
  includes: string[]
}

export interface GitbookBlocksResponse {
  expressions: GitbookExpressionResult[]
  conditions: GitbookConditionResult[]
  references: GitbookReferenceResult[]
  includes: GitbookIncludeResult[]
}

export function resolveGitbookBlocks(
  libraryId: string,
  path: string,
  source: string,
  request: GitbookBlocksRequest,
): Promise<GitbookBlocksResponse> {
  return callBackend<GitbookBlocksResponse>('markdown_blocks_resolve', {
    payload: { libraryId, path, source, ...request },
  })
}
