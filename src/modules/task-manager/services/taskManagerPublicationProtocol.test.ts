import {
  isPublicationSession,
  PUBLICATION_VAULT_ALIAS,
  TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION,
} from './taskManagerPublicationProtocol'
import { describe, expect, it } from 'vitest'

describe('task manager publication protocol', () => {
  it('accepts a versioned publication session and rejects malformed cursors', () => {
    expect(isPublicationSession({
      protocolVersion: TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION,
      publicationEpoch: 'epoch-1',
      sequence: 4,
      revision: 3,
    })).toBe(true)

    expect(isPublicationSession({
      protocolVersion: 2,
      publicationEpoch: 'epoch-1',
      sequence: 4,
      revision: 3,
    })).toBe(false)
    expect(isPublicationSession({
      protocolVersion: TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION,
      publicationEpoch: ' ',
      sequence: 4,
      revision: 3,
    })).toBe(false)
    expect(isPublicationSession({
      protocolVersion: TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION,
      publicationEpoch: 'epoch-1',
      sequence: -1,
      revision: 3,
    })).toBe(false)
  })

  it('keeps the public vault alias explicit in the contract', () => {
    expect(PUBLICATION_VAULT_ALIAS).toBe('published-vault')
  })
})
