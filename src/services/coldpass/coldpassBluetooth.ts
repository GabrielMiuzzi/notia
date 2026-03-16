import { invoke } from '@tauri-apps/api/core'

export const COLDPASS_BLUETOOTH_DEVICE_NAME = 'ColdPass'
export const COLDPASS_BLUETOOTH_SERVICE_UUID = '8f95d4ef-6b74-4b7a-84b1-75a0ad8e4b61'
export const COLDPASS_BLUETOOTH_RX_CHARACTERISTIC_UUID = '4834f924-b2a8-4d65-b0f0-8e6c12fd72be'
export const COLDPASS_BLUETOOTH_TX_CHARACTERISTIC_UUID = '06342a5f-8f7b-44b8-9c6c-bf7feab42054'

export interface ColdPassBluetoothStatus {
  supported: boolean
  connected: boolean
  phase: string
  applicationAuthenticated: boolean
  deviceId: string | null
  deviceName: string | null
  serviceUuid: string | null
  promptMessage: string | null
  errorMessage: string | null
}

function normalizeBluetoothStatus(value: ColdPassBluetoothStatus): ColdPassBluetoothStatus {
  return {
    supported: Boolean(value.supported),
    connected: Boolean(value.connected),
    phase: typeof value.phase === 'string' && value.phase.trim() ? value.phase : 'idle',
    applicationAuthenticated: Boolean(value.applicationAuthenticated),
    deviceId: typeof value.deviceId === 'string' && value.deviceId.trim() ? value.deviceId : null,
    deviceName: typeof value.deviceName === 'string' && value.deviceName.trim() ? value.deviceName : null,
    serviceUuid: typeof value.serviceUuid === 'string' && value.serviceUuid.trim() ? value.serviceUuid : null,
    promptMessage: typeof value.promptMessage === 'string' && value.promptMessage.trim() ? value.promptMessage : null,
    errorMessage: typeof value.errorMessage === 'string' && value.errorMessage.trim() ? value.errorMessage : null,
  }
}

export async function getColdPassBluetoothStatus(): Promise<ColdPassBluetoothStatus> {
  return normalizeBluetoothStatus(await invoke<ColdPassBluetoothStatus>('coldpass_bluetooth_status'))
}

export async function connectColdPassBluetooth(): Promise<ColdPassBluetoothStatus> {
  return normalizeBluetoothStatus(await invoke<ColdPassBluetoothStatus>('coldpass_bluetooth_connect'))
}

export async function disconnectColdPassBluetooth(): Promise<ColdPassBluetoothStatus> {
  return normalizeBluetoothStatus(await invoke<ColdPassBluetoothStatus>('coldpass_bluetooth_disconnect'))
}

export async function submitColdPassBluetoothPin(pin: string): Promise<ColdPassBluetoothStatus> {
  return normalizeBluetoothStatus(await invoke<ColdPassBluetoothStatus>('coldpass_bluetooth_submit_pin', {
    payload: { pin },
  }))
}

export async function authenticateColdPassBluetooth(packet: string): Promise<ColdPassBluetoothStatus> {
  return normalizeBluetoothStatus(await invoke<ColdPassBluetoothStatus>('coldpass_bluetooth_authenticate', {
    payload: { packet },
  }))
}

export async function sendColdPassBluetoothMessage(packet: string): Promise<ColdPassBluetoothStatus> {
  return normalizeBluetoothStatus(await invoke<ColdPassBluetoothStatus>('coldpass_bluetooth_send_message', {
    payload: { packet },
  }))
}
