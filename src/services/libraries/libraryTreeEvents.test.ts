import { describe, expect, it } from 'vitest'
import { resolveSharedPath } from './libraryTreeEvents'

describe('resolveSharedPath', () => {
  it('keeps the Windows verbatim prefix the desktop catalog uses', () => {
    // 2026-10-06: «//?/C:/…/gaia» became «/?/C:/…/gaia», the event missed the
    // library and the tree only refreshed later, on focus.
    expect(resolveSharedPath(['//?/C:/Users/g/notia/gaia'])).toBe('//?/C:/Users/g/notia/gaia')
    expect(resolveSharedPath(['//?/C:/Users/g/notia/gaia/Notas', '//?/C:/Users/g/notia/gaia/Ideas/a.md']))
      .toBe('//?/C:/Users/g/notia/gaia')
    expect(resolveSharedPath(['\\\\?\\C:\\Users\\g\\gaia\\Notas\\a.md'])).toBe('//?/C:/Users/g/gaia/Notas/a.md')
  })

  it('keeps drive, absolute and network paths as they were written', () => {
    expect(resolveSharedPath(['C:/libs/gaia/a', 'C:/libs/gaia/b'])).toBe('C:/libs/gaia')
    expect(resolveSharedPath(['C:/a', 'C:/b'])).toBe('C:/')
    expect(resolveSharedPath(['/home/u/notes/a', '/home/u/notes/b/c'])).toBe('/home/u/notes')
    expect(resolveSharedPath(['//server/share/a', '//server/share/b'])).toBe('//server/share')
  })

  it('leaves SAF URIs untouched and drops a hint that mixes roots', () => {
    const tree = 'content://com.android.externalstorage.documents/tree/primary%3Agaia'
    expect(resolveSharedPath([tree, tree])).toBe(tree)
    expect(resolveSharedPath([tree, `${tree}/document/primary%3Agaia%2Fa.md`])).toBeUndefined()
    expect(resolveSharedPath(['//?/C:/a', 'C:/a'])).toBeUndefined()
    expect(resolveSharedPath(['C:/a', 'D:/a'])).toBeUndefined()
    expect(resolveSharedPath([])).toBeUndefined()
  })
})
