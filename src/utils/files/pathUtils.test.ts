import { describe, expect, it } from 'vitest'
import { normalizeFilesystemPath } from './normalizeFilesystemPath'
import { join } from './pathUtils'
import { getSafTreeDisplayName, isSameOrNestedSafPath, isSafDocumentUri, isSafTreeUri, normalizeSafTreeUri } from './safUri'

describe('Android SAF paths', () => {
  const treeUri = 'content://com.android.externalstorage.documents/tree/primary%3ANotas'

  it('preserves content URIs during path normalization', () => {
    expect(normalizeFilesystemPath(treeUri)).toBe(treeUri)
  })

  it('appends entries without corrupting the content URI scheme', () => {
    expect(join(treeUri, '.notia', 'notiaConfig.json'))
      .toBe(`${treeUri}/.notia/notiaConfig.json`)
  })

  it('accepts only a tree grant as the Android library root', () => {
    expect(normalizeSafTreeUri(treeUri)).toBe(treeUri)
    expect(isSafTreeUri(`${treeUri}/document/primary%3ANotas%2Fnota.md`)).toBe(false)
    expect(isSafDocumentUri(`${treeUri}/document/primary%3ANotas%2Fnota.md`)).toBe(true)
    expect(normalizeSafTreeUri('content:/invalid')).toBeNull()
  })

  it('requires a path segment boundary when comparing SAF logical paths', () => {
    expect(isSameOrNestedSafPath(treeUri, `${treeUri}/.notia`)).toBe(true)
    expect(isSameOrNestedSafPath(treeUri, `${treeUri}-other`)).toBe(false)
  })

  it('decodes the selected Android folder name from the tree URI', () => {
    expect(getSafTreeDisplayName(
      'content://com.android.externalstorage.documents/tree/primary%3Asyncthing%2FWork-sync',
    )).toBe('Work-sync')
  })
})
