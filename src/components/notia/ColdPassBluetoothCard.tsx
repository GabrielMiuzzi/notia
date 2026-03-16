import { useEffect, useState } from 'react'
import { Bluetooth, Shield, Unplug } from 'lucide-react'
import { NotiaButton } from '../common/NotiaButton'
import {
  COLDPASS_BLUETOOTH_DEVICE_NAME,
  COLDPASS_BLUETOOTH_SERVICE_UUID,
  authenticateColdPassBluetooth,
  connectColdPassBluetooth,
  disconnectColdPassBluetooth,
  getColdPassBluetoothStatus,
  sendColdPassBluetoothMessage,
  submitColdPassBluetoothPin,
  type ColdPassBluetoothStatus,
} from '../../services/coldpass/coldpassBluetooth'
import { createColdPassEncryptedPacket } from '../../services/coldpass/coldpassSecureLink'
import { ColdPassBluetoothAuthModal } from './ColdPassBluetoothAuthModal'
import { ColdPassBluetoothMessageModal } from './ColdPassBluetoothMessageModal'
import { ColdPassBluetoothPinModal } from './ColdPassBluetoothPinModal'

type ColdPassBluetoothViewStatus = 'idle' | 'searching' | 'connected' | 'error' | 'unsupported'

function getStatusLabel(status: ColdPassBluetoothViewStatus): string {
  if (status === 'searching') {
    return 'Buscando'
  }

  if (status === 'connected') {
    return 'Conectado'
  }

  if (status === 'error') {
    return 'Error'
  }

  if (status === 'unsupported') {
    return 'No disponible'
  }

  return 'Sin vincular'
}

function resolveViewStatus(status: ColdPassBluetoothStatus | null): ColdPassBluetoothViewStatus {
  if (!status) {
    return 'idle'
  }

  if (!status.supported) {
    return 'unsupported'
  }

  if (status.connected) {
    return 'connected'
  }

  if (status.phase === 'searching' || status.phase === 'pairing' || status.phase === 'awaiting-pin') {
    return 'searching'
  }

  if (status.phase === 'error') {
    return 'error'
  }

  return 'idle'
}

function resolveStatusMessage(status: ColdPassBluetoothStatus | null): string {
  if (!status) {
    return 'Consultando estado Bluetooth de ColdPass...'
  }

  if (status.errorMessage) {
    return status.errorMessage
  }

  if (status.promptMessage) {
    return status.promptMessage
  }

  if (!status.supported) {
    return 'Este runtime no expone backend Bluetooth compatible para buscar el dispositivo ColdPass.'
  }

  if (status.connected) {
    return 'ColdPass conectado correctamente.'
  }

  return 'Buscá el dispositivo BLE "ColdPass" y completá el enlace seguro por PIN cuando el sistema lo solicite.'
}

function resolveUnknownErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  if (typeof error === 'object' && error !== null) {
    const maybeMessage = Reflect.get(error, 'message')
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage
    }
  }

  return fallbackMessage
}

export function ColdPassBluetoothCard() {
  const [connectionStatus, setConnectionStatus] = useState<ColdPassBluetoothStatus | null>(null)
  const [viewStatus, setViewStatus] = useState<ColdPassBluetoothViewStatus>('idle')
  const [message, setMessage] = useState('Consultando estado Bluetooth de ColdPass...')
  const [isPinModalOpen, setIsPinModalOpen] = useState(false)
  const [pinErrorMessage, setPinErrorMessage] = useState<string | null>(null)
  const [isSubmittingPin, setIsSubmittingPin] = useState(false)
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null)
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false)
  const [sessionPasskey, setSessionPasskey] = useState<string | null>(null)
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false)
  const [messageErrorMessage, setMessageErrorMessage] = useState<string | null>(null)
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const isBusy = isSubmittingPin || isSubmittingAuth || isSendingMessage

  useEffect(() => {
    let cancelled = false

    const syncStatus = () => {
      void getColdPassBluetoothStatus()
        .then((nextStatus) => {
          if (cancelled) {
            return
          }

          setConnectionStatus(nextStatus)
          setViewStatus(resolveViewStatus(nextStatus))
          setMessage(resolveStatusMessage(nextStatus))
          setPinErrorMessage(nextStatus.phase === 'awaiting-pin' ? nextStatus.errorMessage : null)
          setIsPinModalOpen(nextStatus.phase === 'awaiting-pin')
          setIsAuthModalOpen(nextStatus.connected && !nextStatus.applicationAuthenticated)

          if (!nextStatus.connected) {
            setSessionPasskey(null)
            setIsMessageModalOpen(false)
            setMessageErrorMessage(null)
          }
        })
        .catch((error) => {
          if (cancelled) {
            return
          }

          setConnectionStatus(null)
          setViewStatus('error')
          setMessage(error instanceof Error ? error.message : 'No se pudo consultar el estado Bluetooth.')
        })
    }

    syncStatus()
    const intervalId = window.setInterval(syncStatus, 900)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  const handleSearchDevice = async () => {
    setViewStatus('searching')
    setMessage('Buscando el dispositivo "ColdPass" y esperando el pedido de PIN...')
    setPinErrorMessage(null)

    try {
      const nextStatus = await connectColdPassBluetooth()
      setConnectionStatus(nextStatus)
      setViewStatus(resolveViewStatus(nextStatus))
      setMessage(resolveStatusMessage(nextStatus))
      setIsPinModalOpen(nextStatus.phase === 'awaiting-pin')
    } catch (error) {
      setConnectionStatus(null)
      setViewStatus('error')
      setMessage(error instanceof Error ? error.message : 'No se pudo iniciar la busqueda Bluetooth.')
    }
  }

  const handleSubmitPin = async (pin: string) => {
    setIsSubmittingPin(true)
    setPinErrorMessage(null)

    try {
      const nextStatus = await submitColdPassBluetoothPin(pin)
      setConnectionStatus(nextStatus)
      setViewStatus(resolveViewStatus(nextStatus))
      setMessage(resolveStatusMessage(nextStatus))
      setPinErrorMessage(nextStatus.errorMessage)
      setIsPinModalOpen(nextStatus.phase === 'awaiting-pin')
      setIsAuthModalOpen(nextStatus.connected && !nextStatus.applicationAuthenticated)
    } catch (error) {
      setPinErrorMessage(error instanceof Error ? error.message : 'No se pudo enviar el PIN.')
    } finally {
      setIsSubmittingPin(false)
    }
  }

  const handleDisconnect = async () => {
    try {
      const nextStatus = await disconnectColdPassBluetooth()
      setConnectionStatus(nextStatus)
      setViewStatus(resolveViewStatus(nextStatus))
      setMessage(resolveStatusMessage(nextStatus))
      setIsPinModalOpen(false)
      setIsAuthModalOpen(false)
      setIsMessageModalOpen(false)
      setPinErrorMessage(null)
      setAuthErrorMessage(null)
      setMessageErrorMessage(null)
      setSessionPasskey(null)
    } catch (error) {
      setViewStatus('error')
      setMessage(error instanceof Error ? error.message : 'No se pudo desconectar ColdPass.')
    }
  }

  const handleAuthenticate = async (values: { passkey: string; challenge: string }) => {
    setIsSubmittingAuth(true)
    setAuthErrorMessage(null)

    try {
      const packet = await createColdPassEncryptedPacket('AUTH', values.challenge.trim(), values.passkey.trim())
      const nextStatus = await authenticateColdPassBluetooth(packet)
      setConnectionStatus(nextStatus)
      setViewStatus(resolveViewStatus(nextStatus))
      setMessage(resolveStatusMessage(nextStatus))
      setSessionPasskey(values.passkey.trim())
      setIsAuthModalOpen(false)
    } catch (error) {
      setAuthErrorMessage(resolveUnknownErrorMessage(error, 'No se pudo autenticar el canal seguro.'))
    } finally {
      setIsSubmittingAuth(false)
    }
  }

  const handleSendMessage = async (messageToSend: string) => {
    if (!sessionPasskey) {
      setMessageErrorMessage('La PassKey de la sesion ya no esta disponible en memoria.')
      return
    }

    setIsSendingMessage(true)
    setMessageErrorMessage(null)

    try {
      const packet = await createColdPassEncryptedPacket('MSG', messageToSend.trim(), sessionPasskey)
      const nextStatus = await sendColdPassBluetoothMessage(packet)
      setConnectionStatus(nextStatus)
      setViewStatus(resolveViewStatus(nextStatus))
      setMessage(resolveStatusMessage(nextStatus))
      setIsMessageModalOpen(false)
    } catch (error) {
      setMessageErrorMessage(resolveUnknownErrorMessage(error, 'No se pudo enviar el mensaje cifrado.'))
    } finally {
      setIsSendingMessage(false)
    }
  }

  return (
    <section className="notia-coldpass-bluetooth-card" aria-label="Controlador Bluetooth ColdPass">
      <div className="notia-coldpass-bluetooth-card-main">
        <div className="notia-coldpass-bluetooth-card-icon">
          <Bluetooth size={18} />
        </div>
        <div className="notia-coldpass-bluetooth-card-copy">
          <div className="notia-coldpass-bluetooth-card-header">
            <h3>ColdPass Bluetooth</h3>
            <span className={`notia-coldpass-bluetooth-status notia-coldpass-bluetooth-status--${viewStatus}`}>
              {getStatusLabel(viewStatus)}
            </span>
          </div>
          <p>{message}</p>
          <div className="notia-coldpass-bluetooth-meta">
            <span>
              <strong>Dispositivo:</strong> {connectionStatus?.deviceName ?? COLDPASS_BLUETOOTH_DEVICE_NAME}
            </span>
            <span>
              <strong>Servicio:</strong> {connectionStatus?.serviceUuid ?? COLDPASS_BLUETOOTH_SERVICE_UUID}
            </span>
            {connectionStatus?.deviceId ? (
              <span>
                <strong>Sesion:</strong> {connectionStatus.deviceId}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="notia-coldpass-bluetooth-card-actions">
        <NotiaButton
          variant="primary"
          onClick={() => {
            void handleSearchDevice()
          }}
          disabled={viewStatus === 'searching' || viewStatus === 'unsupported' || isBusy}
        >
          {viewStatus === 'searching' ? 'Buscando...' : 'Buscar dispositivo'}
        </NotiaButton>
        <NotiaButton
          variant="secondary"
          onClick={() => {
            void handleDisconnect()
          }}
          disabled={!connectionStatus || (!connectionStatus.connected && connectionStatus.phase === 'idle') || isBusy}
        >
          <Unplug size={16} />
          Desconectar
        </NotiaButton>
        {connectionStatus?.connected && connectionStatus.applicationAuthenticated ? (
          <NotiaButton
            variant="secondary"
            onClick={() => {
              setMessageErrorMessage(null)
              setIsMessageModalOpen(true)
            }}
            disabled={isBusy}
          >
            Mandar mensaje
          </NotiaButton>
        ) : null}
      </div>
      {isSubmittingAuth ? (
        <div className="notia-coldpass-operation-status notia-coldpass-operation-status--card" role="status" aria-live="polite">
          <div className="notia-coldpass-operation-spinner" aria-hidden="true" />
          <span>Validando PassKey y Challenge con ColdPass...</span>
        </div>
      ) : null}
      {isSubmittingPin ? (
        <div className="notia-coldpass-operation-status notia-coldpass-operation-status--card" role="status" aria-live="polite">
          <div className="notia-coldpass-operation-spinner" aria-hidden="true" />
          <span>Esperando confirmacion del PIN Bluetooth...</span>
        </div>
      ) : null}
      {isSendingMessage ? (
        <div className="notia-coldpass-operation-status notia-coldpass-operation-status--card" role="status" aria-live="polite">
          <div className="notia-coldpass-operation-spinner" aria-hidden="true" />
          <span>Esperando confirmacion del mensaje cifrado...</span>
        </div>
      ) : null}
      <div className="notia-coldpass-bluetooth-card-footer">
        <Shield size={14} />
        <span>Firmware esperado: dispositivo BLE `ColdPass` con autenticacion segura por PIN y servicio cifrado.</span>
      </div>
      <ColdPassBluetoothPinModal
        open={isPinModalOpen}
        message={connectionStatus?.promptMessage ?? 'Ingresá el PIN que muestra la placa ColdPass.'}
        errorMessage={pinErrorMessage}
        isSubmitting={isSubmittingPin}
        onSubmit={(pin) => {
          void handleSubmitPin(pin)
        }}
        onClose={() => {
          void handleDisconnect()
        }}
      />
      <ColdPassBluetoothAuthModal
        open={isAuthModalOpen}
        errorMessage={authErrorMessage}
        isSubmitting={isSubmittingAuth}
        onSubmit={(values) => {
          void handleAuthenticate(values)
        }}
        onClose={() => {
          void handleDisconnect()
        }}
      />
      <ColdPassBluetoothMessageModal
        open={isMessageModalOpen}
        errorMessage={messageErrorMessage}
        isSubmitting={isSendingMessage}
        onSubmit={(messageToSend) => {
          void handleSendMessage(messageToSend)
        }}
        onClose={() => {
          setIsMessageModalOpen(false)
          setMessageErrorMessage(null)
        }}
      />
    </section>
  )
}
