// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const calls = vi.hoisted(() => ({
  login: vi.fn(),
  first: vi.fn(),
  create: vi.fn(),
  change: vi.fn(),
}))

vi.mock('../../../services/auth/appAuthRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/auth/appAuthRuntime')>()),
  loginApp: calls.login,
  checkFirstLogin: calls.first,
  createOwnerPassword: calls.create,
  changeOwnerPassword: calls.change,
}))

const { LoginScreen } = await import('./LoginScreen')

const status = (state: 'locked' | 'setup') => ({
  state,
  libraryId: 'lib-1',
  libraryName: 'Personal',
  remembered: null,
  sessionRemembered: false,
})

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('LoginScreen', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('signs the Owner in with what the switches ask to remember', async () => {
    const onUnlocked = vi.fn()
    calls.login.mockResolvedValue({ ...status('locked'), state: 'unlocked' })
    render(<LoginScreen status={status('locked')} canRemember onUnlocked={onUnlocked} />)
    const login = screen.getByRole('button', { name: 'Login' }) as HTMLButtonElement
    expect(login.disabled).toBe(true)
    type('Usuario', 'Owner')
    type('Contraseña', 'secreto-largo')
    fireEvent.click(screen.getByRole('switch', { name: 'Recordar sesión' }))
    fireEvent.click(login)
    await waitFor(() => expect(onUnlocked).toHaveBeenCalled())
    expect(calls.login).toHaveBeenCalledWith({ libraryId: 'lib-1', username: 'Owner', password: 'secreto-largo', rememberSession: true, rememberData: false })
  })

  it('shows the backend error and keeps the form', async () => {
    calls.login.mockRejectedValue(new Error('Usuario o contraseña incorrectos.'))
    render(<LoginScreen status={status('locked')} canRemember={false} onUnlocked={vi.fn()} />)
    expect(screen.queryByRole('switch', { name: 'Recordar sesión' })).toBeNull()
    type('Usuario', 'Owner')
    type('Contraseña', 'mala-clave')
    fireEvent.click(screen.getByRole('button', { name: 'Login' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Usuario o contraseña incorrectos.')
  })

  it('creates the first password and goes back to sign in', async () => {
    calls.first.mockResolvedValue(undefined)
    calls.create.mockResolvedValue(status('locked'))
    render(<LoginScreen status={status('setup')} canRemember onUnlocked={vi.fn()} />)
    expect(screen.getByRole('switch', { name: 'Primer inicio' }).getAttribute('aria-checked')).toBe('true')
    type('Usuario', 'Owner')
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(await screen.findByRole('heading', { name: 'Creá tu contraseña' })).toBeTruthy()
    type('Contraseña', 'nueva-clave')
    type('Repetir contraseña', 'otra-clave')
    expect(screen.getByText('Las contraseñas no coinciden.')).toBeTruthy()
    type('Repetir contraseña', 'nueva-clave')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }))
    expect(await screen.findByText('Contraseña creada. Ya podés ingresar.')).toBeTruthy()
    expect(calls.create).toHaveBeenCalledWith('lib-1', 'Owner', 'nueva-clave')
    expect(screen.getByRole('switch', { name: 'Primer inicio' }).getAttribute('aria-checked')).toBe('false')
  })

  it('changes the password only with a different, repeated new one', async () => {
    calls.change.mockResolvedValue(status('locked'))
    render(<LoginScreen status={status('locked')} canRemember onUnlocked={vi.fn()} />)
    type('Usuario', 'Owner')
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))
    type('Contraseña actual', 'clave-actual')
    type('Nueva contraseña', 'clave-actual')
    type('Repetir nueva contraseña', 'clave-actual')
    expect(screen.getByText('La nueva contraseña tiene que ser distinta de la actual.')).toBeTruthy()
    const save = screen.getByRole('button', { name: 'Guardar nueva contraseña' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    type('Nueva contraseña', 'clave-nueva')
    type('Repetir nueva contraseña', 'clave-nueva')
    fireEvent.click(save)
    expect(await screen.findByText('Contraseña actualizada. Ingresá con la nueva.')).toBeTruthy()
    expect(calls.change).toHaveBeenCalledWith('lib-1', 'Owner', 'clave-actual', 'clave-nueva')
  })
})
