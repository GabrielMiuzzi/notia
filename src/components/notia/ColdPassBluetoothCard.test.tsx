// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ColdPassBluetoothStatus } from '../../services/coldpass/coldpassBluetooth'
import { ColdPassBluetoothCard } from './ColdPassBluetoothCard'

const getStatus = vi.fn<() => Promise<ColdPassBluetoothStatus>>()
vi.mock('../../services/coldpass/coldpassBluetooth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/coldpass/coldpassBluetooth')>()),
  getColdPassBluetoothStatus: () => getStatus(),
}))

function status(overrides: Partial<ColdPassBluetoothStatus>): ColdPassBluetoothStatus {
  return {
    supported: true,
    connected: false,
    phase: 'idle',
    applicationAuthenticated: false,
    deviceId: null,
    deviceName: null,
    serviceUuid: null,
    promptMessage: null,
    errorMessage: null,
    ...overrides,
  }
}

describe('ColdPassBluetoothCard', () => {
  afterEach(() => {
    cleanup()
    getStatus.mockReset()
  })

  it('shows the service details and the long copy on a wide view', async () => {
    getStatus.mockResolvedValue(status({}))
    render(<ColdPassBluetoothCard />)
    expect(await screen.findByText('Tocá Vincular y confirmá el PIN en el dispositivo para iniciar el pairing seguro.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Vincular dispositivo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copiar UUID del servicio' })).toBeTruthy()
  })

  it('follows the phone board when compact', async () => {
    getStatus.mockResolvedValue(status({}))
    render(<ColdPassBluetoothCard compact />)
    expect(await screen.findByText('Vinculá y confirmá el PIN en el dispositivo.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Vincular' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copiar UUID del servicio' })).toBeNull()
  })

  it('says what the device reports before the copy of its state', async () => {
    getStatus.mockResolvedValue(status({ phase: 'error', errorMessage: 'Bluetooth apagado.' }))
    render(<ColdPassBluetoothCard compact />)
    expect(await screen.findByText('Bluetooth apagado.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Vincular' })).toBeTruthy()
  })

  it('counts its actions so the phone card can put two on their own row', async () => {
    getStatus.mockResolvedValue(status({ connected: true, applicationAuthenticated: true, phase: 'connected' }))
    render(<ColdPassBluetoothCard compact />)
    expect(await screen.findByText('Pairing por PIN verificado.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mandar mensaje' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Dispositivo ColdPass' }).getAttribute('data-actions')).toBe('2')
  })
})
