// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ColdPassEntryView } from '../../../types/coldpass'
import { ColdPassView } from './ColdPassView'
import { formatAgo, formatChanged, formatReplaced, siteHref, vaultSummary } from './coldpass/coldPassFormat'

const copyColdPassSecret = vi.fn()
vi.mock('../../../services/coldpass/coldpassStorage', () => ({
  copyColdPassSecret: (...args: unknown[]) => copyColdPassSecret(...args),
}))
vi.mock('../../../services/transport', () => ({
  backendSupports: (command: string) => command === 'coldpass_pick_csv_import',
}))

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date(2026, 8, 28, 12).getTime()

function entry(overrides: Partial<ColdPassEntryView>): ColdPassEntryView {
  return {
    id: overrides.name ?? 'id',
    name: 'Cuenta',
    website: '',
    username: 'gabmiuzzi',
    secondaryUsername: '',
    password: 'r9$Lk2@pWz7!eN',
    notes: '',
    passwordHistory: [],
    passwordChangedAt: NOW - 30 * DAY,
    health: 'strong',
    ...overrides,
  }
}

const ENTRIES: ColdPassEntryView[] = [
  entry({ name: 'AWS', website: 'console.aws.amazon.com', health: 'old', passwordChangedAt: NOW - 425 * DAY, secondaryUsername: '4821 0937 6612' }),
  entry({ name: 'GitHub', website: 'https://github.com/', passwordHistory: [{ password: 'gh-Gab#2025', replacedAt: NOW - 40 * DAY }] }),
  entry({ name: 'Mercado Pago', website: 'mercadopago.com.ar', password: 'mercado123', health: 'weak' }),
  entry({
    name: 'test',
    website: 'www.google.com.ar',
    notes: 'Cuenta principal',
    passwordHistory: [1, 2, 3, 4, 5].map((index) => ({ password: `vieja-${index}`, replacedAt: NOW - index * 90 * DAY })),
  }),
]

function renderView(entries = ENTRIES) {
  const props = {
    entries,
    isUnlocked: true,
    onCreateCredential: vi.fn(),
    onImportVault: vi.fn(),
    onEditCredential: vi.fn(),
    onDeleteCredential: vi.fn(),
  }
  render(<ColdPassView {...props} />)
  return props
}

function list() {
  return within(screen.getByRole('navigation', { name: 'Credenciales' }))
}

function detail() {
  return within(screen.getByRole('region', { name: 'Detalle de la credencial' }))
}

describe('ColdPassView', () => {
  afterEach(() => {
    cleanup()
    copyColdPassSecret.mockReset()
  })

  it('summarizes the vault and filters by the health the backend decided', () => {
    renderView()
    expect(screen.getByText('4 credenciales en el vault, 1 débil y 1 para rotar')).toBeTruthy()
    expect(list().getAllByRole('button', { pressed: false }).map((button) => button.textContent)).toEqual(
      expect.arrayContaining(['Débiles1', 'Antiguas1']),
    )
    fireEvent.click(list().getByRole('button', { name: /Débiles/ }))
    expect(list().getByText('Mercado Pago')).toBeTruthy()
    expect(list().queryByText('GitHub')).toBeNull()
  })

  it('searches names, sites, users and notes and offers to clear the search', () => {
    renderView()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar credenciales' }), { target: { value: 'principal' } })
    expect(list().getByText('test')).toBeTruthy()
    expect(list().queryByText('AWS')).toBeNull()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar credenciales' }), { target: { value: 'nada' } })
    fireEvent.click(list().getByRole('button', { name: 'Limpiar búsqueda' }))
    expect(list().getByText('AWS')).toBeTruthy()
  })

  it('shows the selected credential and asks to rotate an old password', () => {
    const props = renderView()
    expect(detail().getByRole('heading', { name: 'AWS' })).toBeTruthy()
    expect(detail().getByText('Tiene más de un año sin cambios. Conviene rotarla.')).toBeTruthy()
    expect(detail().getByText('4821 0937 6612')).toBeTruthy()
    fireEvent.click(detail().getByRole('button', { name: 'Generar nueva' }))
    expect(props.onEditCredential).toHaveBeenCalledWith(0, { generate: true })
    fireEvent.click(detail().getByRole('button', { name: 'Eliminar credencial' }))
    expect(props.onDeleteCredential).toHaveBeenCalledWith(0)
  })

  it('reveals and copies the password through the backend clipboard', async () => {
    copyColdPassSecret.mockResolvedValue({ clearsAfterSeconds: 30 })
    renderView()
    fireEvent.click(list().getByText('GitHub'))
    expect(detail().queryByText('r9$Lk2@pWz7!eN')).toBeNull()
    fireEvent.click(detail().getByRole('button', { name: 'Mostrar contraseña' }))
    expect(detail().getByText('r9$Lk2@pWz7!eN')).toBeTruthy()
    fireEvent.click(detail().getByRole('button', { name: 'Copiar' }))
    expect(copyColdPassSecret).toHaveBeenCalledWith('r9$Lk2@pWz7!eN')
    expect(await screen.findByText('Contraseña copiada. Se borra del portapapeles en 30 s.')).toBeTruthy()
  })

  it('shows three previous passwords and the rest on demand', () => {
    renderView()
    fireEvent.click(list().getByText('test'))
    expect(detail().getAllByText(/^Reemplazada el/)).toHaveLength(3)
    fireEvent.click(detail().getByRole('button', { name: /Ver las 2 anteriores/ }))
    expect(detail().getAllByText(/^Reemplazada el/)).toHaveLength(5)
  })

  it('has an empty state for a new vault', () => {
    const props = renderView([])
    expect(screen.getByText('Todavía no hay credenciales en el vault')).toBeTruthy()
    fireEvent.click(list().getByRole('button', { name: 'Nueva credencial' }))
    expect(props.onCreateCredential).toHaveBeenCalled()
  })
})

describe('coldPassFormat', () => {
  it('writes relative change dates like the design', () => {
    expect(formatAgo(NOW - 3 * DAY, NOW)).toBe('hace 3 días')
    expect(formatAgo(NOW - 31 * DAY, NOW)).toBe('hace 1 mes')
    expect(formatAgo(NOW - 425 * DAY, NOW)).toBe('hace 13 meses')
    expect(formatAgo(NOW - 3 * 365 * DAY, NOW)).toBe('hace 3 años')
    expect(formatAgo(NOW - 1000, NOW)).toBe('hoy')
    expect(formatChanged(null, NOW)).toBe('Sin fecha de cambio')
    expect(formatReplaced(new Date(2026, 8, 25).getTime())).toBe('Reemplazada el 25 sep 2026')
  })

  it('links only web addresses', () => {
    expect(siteHref('console.aws.amazon.com')).toBe('https://console.aws.amazon.com')
    expect(siteHref('192.168.0.1')).toBe('http://192.168.0.1')
    expect(siteHref('https://github.com/')).toBe('https://github.com/')
    expect(siteHref('Router casa')).toBeNull()
    expect(siteHref('')).toBeNull()
  })

  it('pluralizes the summary', () => {
    expect(vaultSummary([entry({ health: 'weak' })])).toBe('1 credencial en el vault, 1 débil')
    expect(vaultSummary([entry({}), entry({})])).toBe('2 credenciales en el vault')
  })
})
