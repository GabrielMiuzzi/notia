// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ColdPassCredentialModal } from './ColdPassCredentialModal'
import type { ColdPassEntry } from '../../types/coldpass'

const generateColdPassPassword = vi.fn()
const rateColdPassPassword = vi.fn()
vi.mock('../../services/coldpass/coldpassStorage', () => ({
  generateColdPassPassword: (...args: unknown[]) => generateColdPassPassword(...args),
  rateColdPassPassword: (...args: unknown[]) => rateColdPassPassword(...args),
}))

const ENTRY: ColdPassEntry = {
  id: 'a',
  name: 'test',
  website: 'www.google.com.ar',
  username: 'gabmiuzzi',
  secondaryUsername: '',
  password: 'Tq8!mZ2rVx#4',
  notes: '',
  passwordHistory: [],
  passwordChangedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
}

function renderEdit(onSubmit = vi.fn()) {
  render(<ColdPassCredentialModal open mode="edit" initialEntry={ENTRY} onSubmit={onSubmit} onClose={() => {}} />)
  return onSubmit
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })
}

describe('ColdPassCredentialModal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    generateColdPassPassword.mockResolvedValue({
      password: 'Gen3rada!Segura#2026xy',
      bruteForceSeconds: 1e20,
      rating: { level: 4, label: 'Muy fuerte', hint: 'resiste siglos de fuerza bruta' },
    })
    rateColdPassPassword.mockResolvedValue({ level: 3, label: 'Fuerte', hint: 'resiste años de fuerza bruta' })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    generateColdPassPassword.mockReset()
    rateColdPassPassword.mockReset()
  })

  it('saves only after a change and shows how long ago the password changed', async () => {
    const onSubmit = renderEdit()
    await settle()
    const [save] = screen.getAllByRole('button', { name: 'Guardar cambios' })
    expect(save.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Cambiada hace 3 días')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('ID de cuenta, DNI, alias…'), { target: { value: 'cuenta-7' } })
    expect(screen.getAllByText('Cambios sin guardar').length).toBeGreaterThan(0)
    expect(save.hasAttribute('disabled')).toBe(false)
    fireEvent.click(save)
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', secondaryUsername: 'cuenta-7', password: ENTRY.password }))
  })

  it('rates the typed password in the backend with the fields it must not reuse', async () => {
    renderEdit()
    await settle()
    expect(screen.getByText('Fuerte')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Contraseña', { selector: 'input' }), { target: { value: 'otra' } })
    await settle()
    expect(rateColdPassPassword).toHaveBeenLastCalledWith({ password: 'otra', name: 'test', website: 'www.google.com.ar', username: 'gabmiuzzi' })
    expect(screen.getByText('Al guardar, la contraseña actual pasa al historial.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer cambio Deshacer' }))
    expect((screen.getByLabelText('Contraseña', { selector: 'input' }) as HTMLInputElement).value).toBe(ENTRY.password)
  })

  it('applies the generated password and asks the backend again when an option changes', async () => {
    renderEdit()
    await settle()
    expect(screen.getByText('Muy fuerte, resiste siglos de fuerza bruta.')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /Símbolos/ }))
    await settle()
    expect(generateColdPassPassword).toHaveBeenLastCalledWith(expect.objectContaining({ length: 20, includeSpecialCharacters: false, avoidAmbiguous: true }))

    fireEvent.click(screen.getByRole('button', { name: 'Usar esta contraseña' }))
    expect((screen.getByLabelText('Contraseña', { selector: 'input' }) as HTMLInputElement).value).toBe('Gen3rada!Segura#2026xy')
    expect(screen.getByText('Contraseña generada aplicada. Guardá para confirmar.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Usar esta contraseña' })).toBeNull()
  })

  it('asks for a name once the field was touched', async () => {
    renderEdit()
    await settle()
    fireEvent.change(screen.getByPlaceholderText('Ej. Google personal'), { target: { value: ' ' } })
    expect(screen.getByText('Poné un nombre para encontrarla después.')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Guardar cambios' })[0].hasAttribute('disabled')).toBe(true)
  })
})
