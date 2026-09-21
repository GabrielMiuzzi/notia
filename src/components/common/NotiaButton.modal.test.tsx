// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { NotiaButton } from '../common/NotiaButton'
import { NotiaModalShell } from '../notia/NotiaModalShell'
import {
  beginPhantomClickSuppression,
  resetPhantomClickSuppressionForTests,
} from '../../utils/interactions/phantomClickSuppression'

describe('NotiaButton pointer activation', () => {
  afterEach(() => {
    cleanup()
    resetPhantomClickSuppressionForTests()
  })

  it('does not call the consumer twice for one tap (programmatic + trusted click)', () => {
    const onClick = vi.fn()
    render(<NotiaButton onClick={onClick}>Aceptar</NotiaButton>)
    const button = screen.getByRole('button', { name: 'Aceptar' })

    const pointerId = 7
    const pointerDown = new PointerEvent('pointerdown', {
      pointerId,
      pointerType: 'touch',
      button: 0,
      clientX: 10,
      clientY: 10,
      bubbles: true,
      composed: true,
    })
    Object.defineProperty(pointerDown, 'target', { value: button })
    button.setPointerCapture = () => undefined
    button.hasPointerCapture = () => false
    button.releasePointerCapture = () => undefined
    fireEvent(button, pointerDown)

    const pointerUp = new PointerEvent('pointerup', {
      pointerId,
      pointerType: 'touch',
      button: 0,
      clientX: 11,
      clientY: 11,
      bubbles: true,
      composed: true,
    })
    Object.defineProperty(pointerUp, 'target', { value: button })
    const prevented = fireEvent(button, pointerUp)

    expect(prevented).toBe(true)
    expect(onClick).toHaveBeenCalledTimes(1)

    // The platform dispatches its own trusted click for the same tap.
    const trustedClick = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true })
    Object.defineProperty(trustedClick, 'isTrusted', { value: true })
    Object.defineProperty(trustedClick, 'target', { value: button })
    fireEvent(button, trustedClick)

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('still activates from mouse and keyboard without pointer interception', () => {
    const onClick = vi.fn()
    render(<NotiaButton onClick={onClick}>Enviar</NotiaButton>)
    const button = screen.getByRole('button', { name: 'Enviar' })

    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(button, { key: 'Enter' })
    fireEvent.keyUp(button, { key: 'Enter' })
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('NotiaModalShell dismissal', () => {
  function buttonTap(pointerId: number, button: HTMLElement): void {
    const pointerDown = new PointerEvent('pointerdown', {
      pointerId,
      pointerType: 'touch',
      button: 0,
      clientX: 10,
      clientY: 10,
      bubbles: true,
      composed: true,
    })
    Object.defineProperty(pointerDown, 'target', { value: button })
    button.setPointerCapture = () => undefined
    button.hasPointerCapture = () => false
    button.releasePointerCapture = () => undefined
    fireEvent(button, pointerDown)

    const pointerUp = new PointerEvent('pointerup', {
      pointerId,
      pointerType: 'touch',
      button: 0,
      clientX: 11,
      clientY: 11,
      bubbles: true,
      composed: true,
    })
    Object.defineProperty(pointerUp, 'target', { value: button })
    fireEvent(button, pointerUp)
  }

  function ModalHarness({ startOpen }: { startOpen: boolean }) {
    const [open, setOpen] = useState(startOpen)
    return (
      <>
        <NotiaButton onClick={() => setOpen(true)}>Abrir</NotiaButton>
        <NotiaModalShell open={open} onClose={() => setOpen(false)}>
          <NotiaButton onClick={() => setOpen(false)}>Cerrar panel</NotiaButton>
        </NotiaModalShell>
      </>
    )
  }

  function ModalTriggerHarness() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <NotiaButton onClick={() => setOpen(true)}>Abrir ajustes</NotiaButton>
        <NotiaModalShell open={open} onClose={() => setOpen(false)}>
          <div>Panel de configuraciones</div>
        </NotiaModalShell>
      </>
    )
  }

  beforeEach(() => {
    resetPhantomClickSuppressionForTests()
  })

  afterEach(() => {
    cleanup()
    resetPhantomClickSuppressionForTests()
  })

  it('keeps the modal mounted when a phantom trusted click retargets the backdrop', () => {
    render(<ModalTriggerHarness />)
    const trigger = screen.getByRole('button', { name: 'Abrir ajustes' })

    // Simulate the Android tap sequence: pointerdown, pointerup (programmatic
    // activation mounting the modal), then the platform's trusted click
    // retargeted to the freshly mounted backdrop.
    const pointerId = 3
    buttonTap(pointerId, trigger)

    expect(screen.getByRole('dialog')).toBeTruthy()

    const trustedClick = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true })
    Object.defineProperty(trustedClick, 'isTrusted', { value: true })
    const backdrop = document.querySelector('.notia-modal-engine-backdrop')!
    Object.defineProperty(trustedClick, 'target', { value: backdrop })
    fireEvent(backdrop, trustedClick)

    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('closes on pointerdown on the backdrop and not on interactions inside the panel', () => {
    render(<ModalHarness startOpen />)
    expect(screen.getByRole('dialog')).toBeTruthy()

    const panel = document.querySelector('.notia-modal-engine-panel')!
    fireEvent.click(panel)
    expect(screen.getByRole('dialog')).toBeTruthy()

    fireEvent.pointerDown(panel, { pointerType: 'touch' })
    expect(screen.getByRole('dialog')).toBeTruthy()

    const backdrop = document.querySelector('.notia-modal-engine-backdrop')!
    fireEvent.pointerDown(backdrop, { pointerType: 'mouse', clientX: 1000, clientY: 1000 })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not close when Android retargets an inner touch to the backdrop', () => {
    render(<ModalHarness startOpen />)
    const panel = document.querySelector('.notia-modal-engine-panel') as HTMLElement
    const backdrop = document.querySelector('.notia-modal-engine-backdrop') as HTMLElement
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 100,
      top: 100,
      left: 100,
      right: 500,
      bottom: 400,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    })

    // Some Android WebViews report the backdrop as the pointer target even
    // though the finger is still over a control inside the panel.
    fireEvent.pointerDown(backdrop, { pointerType: 'touch', clientX: 180, clientY: 180 })

    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('closes with Escape from inside the panel', () => {
    render(<ModalHarness startOpen />)
    const panel = document.querySelector('.notia-modal-engine-panel') as HTMLElement
    expect(panel.tabIndex).toBe(-1)
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.getAttribute('aria-modal')).toBe('true')

    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    // Opening again restores the focus to the previously focused opener.
    const opener = screen.getByRole('button', { name: 'Abrir' })
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document.querySelector('.notia-modal-engine-panel')!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})

describe('phantomClickSuppression gate', () => {
  afterEach(() => {
    cleanup()
    resetPhantomClickSuppressionForTests()
  })

  it('suppresses trusted clicks outside the owned element inside the window', () => {
    const container = document.createElement('div')
    container.innerHTML = '<button id="owned">Dentro</button><div id="outside">Fuera</div>'
    document.body.appendChild(container)
    const owned = container.querySelector('#owned')!
    const outside = container.querySelector('#outside')!
    const outsideListener = vi.fn()
    outside.addEventListener('click', outsideListener)

    beginPhantomClickSuppression(owned)
    const trustedClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    Object.defineProperty(trustedClick, 'isTrusted', { value: true })
    Object.defineProperty(trustedClick, 'target', { value: outside })
    outside.dispatchEvent(trustedClick)

    expect(outsideListener).not.toHaveBeenCalled()
    expect(trustedClick.defaultPrevented).toBe(true)
  })

  it('keeps untrusted clicks working during the window', () => {
    const container = document.createElement('div')
    container.innerHTML = '<button id="owned">Dentro</button><div id="outside">Fuera</div>'
    document.body.appendChild(container)
    const owned = container.querySelector('#owned')!
    const outside = container.querySelector('#outside')!
    const outsideListener = vi.fn()
    outside.addEventListener('click', outsideListener)

    beginPhantomClickSuppression(owned)
    const syntheticClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    Object.defineProperty(syntheticClick, 'target', { value: outside })
    outside.dispatchEvent(syntheticClick)

    expect(outsideListener).toHaveBeenCalledTimes(1)
    expect(syntheticClick.defaultPrevented).toBe(false)
  })

  it('lets a trusted click on the owned element re-arm cleanly', () => {
    const container = document.createElement('div')
    container.innerHTML = '<button id="owned">Dentro</button>'
    document.body.appendChild(container)
    const owned = container.querySelector('#owned')!
    const ownedListener = vi.fn()
    owned.addEventListener('click', ownedListener)

    beginPhantomClickSuppression(owned)
    const trustedClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    Object.defineProperty(trustedClick, 'isTrusted', { value: true })
    Object.defineProperty(trustedClick, 'target', { value: owned })
    owned.dispatchEvent(trustedClick)

    expect(ownedListener).toHaveBeenCalledTimes(1)
    expect(trustedClick.defaultPrevented).toBe(false)

    const secondTrustedClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    Object.defineProperty(secondTrustedClick, 'isTrusted', { value: true })
    Object.defineProperty(secondTrustedClick, 'target', { value: owned })
    owned.dispatchEvent(secondTrustedClick)
    expect(ownedListener).toHaveBeenCalledTimes(2)
  })
})
