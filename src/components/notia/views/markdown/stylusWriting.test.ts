// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { isSystemStylusPress, leaveStylusToSystem, writesWithStylus } from './stylusWriting'

function press(target: Element, pointerType: string) {
  const down = new Event('pointerdown', { bubbles: true }) as Event & { pointerType: string }
  down.pointerType = pointerType
  target.dispatchEvent(down)
  const mouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  target.dispatchEvent(mouse)
  const up = new Event('pointerup', { bubbles: true }) as Event & { pointerType: string }
  up.pointerType = pointerType
  target.dispatchEvent(up)
  return mouse
}

describe('stylus handwriting on Android', () => {
  let cleanup = () => {}
  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
  })

  const setup = (android: boolean, selector = true) => {
    const host = document.createElement('div')
    const editor = document.createElement('div')
    host.append(editor)
    document.body.append(host)
    const seen: string[] = []
    editor.addEventListener('mousedown', () => seen.push('editor'))
    cleanup = leaveStylusToSystem(host, () => selector, android)
    return { editor, seen }
  }

  it('tells Android from other systems', () => {
    expect(writesWithStylus('Mozilla/5.0 (Linux; Android 16; TB520FU) AppleWebKit/537.36')).toBe(true)
    expect(writesWithStylus('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false)
    expect(isSystemStylusPress({ pointerType: 'pen' }, true)).toBe(true)
    expect(isSystemStylusPress({ pointerType: 'touch' }, true)).toBe(false)
    expect(isSystemStylusPress({ pointerType: 'pen' }, false)).toBe(false)
  })

  it('keeps the editor from turning a stylus press into a drag selection', () => {
    const { editor, seen } = setup(true)
    const mouse = press(editor, 'pen')
    // The press still places the caret: only the editor's handler is skipped.
    expect(mouse.defaultPrevented).toBe(false)
    expect(seen).toEqual([])
    press(editor, 'mouse')
    expect(seen).toEqual(['editor'])
  })

  it('leaves the stylus alone with a drawing tool and outside Android', () => {
    const drawing = setup(true, false)
    press(drawing.editor, 'pen')
    expect(drawing.seen).toEqual(['editor'])
    cleanup()
    document.body.innerHTML = ''
    const windows = setup(false)
    press(windows.editor, 'pen')
    expect(windows.seen).toEqual(['editor'])
  })
})
