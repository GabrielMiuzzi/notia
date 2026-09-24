import { describe, expect, it } from 'vitest'
import { normalizeFilesystemPath } from './normalizeFilesystemPath'

describe('Android SAF paths', () => {
  const treeUri = 'content://com.android.externalstorage.documents/tree/primary%3ANotas'

  it('preserves content URIs during path normalization', () => {
    expect(normalizeFilesystemPath(treeUri)).toBe(treeUri)
  })

})
