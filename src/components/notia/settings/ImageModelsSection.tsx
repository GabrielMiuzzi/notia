import { useCallback, useEffect, useState } from 'react'
import { Download, Trash2, X } from 'lucide-react'
import { NotiaButton } from '../../common/NotiaButton'
import { SettingsBadge, SettingsCard, SettingsFooter, SettingsRow, type SettingsTone } from './SettingsControls'
import {
  cancelImageModelsDownload,
  deleteImageModels,
  downloadImageModels,
  getImageModelsStatus,
  imageModelsSupported,
  type ImageModelsStatus,
} from '../../../services/ai/imageModelsService'

const POLL_MS = 1000

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return fallback
}

function gigabytes(bytes: number): string {
  return `${(bytes / 1e9).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`
}

/**
 * «Imágenes»: el modelo local con el que el asistente genera y edita
 * imágenes. Rust descarga, verifica y borra los archivos; acá solo se
 * muestra el estado y se piden esas acciones.
 */
export function ImageModelsSection() {
  const [status, setStatus] = useState<ImageModelsStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setStatus(await getImageModelsStatus())
    } catch (reason) {
      setError(messageOf(reason, 'No se pudo leer el estado de los modelos de imágenes.'))
    }
  }, [])

  useEffect(() => {
    if (!imageModelsSupported()) return
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!status?.downloading) return
    const timer = window.setInterval(() => { void refresh() }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [status?.downloading, refresh])

  const run = async (action: () => Promise<ImageModelsStatus>, fallback: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      setStatus(await action())
    } catch (reason) {
      setError(messageOf(reason, fallback))
    } finally {
      setBusy(false)
    }
  }

  if (!imageModelsSupported() || (status && !status.supported)) {
    return (
      <SettingsCard>
        <div className="notia-settings-empty">
          Las imágenes se generan en la PC con Windows. Desde el celular, conectate a ella como cliente y pedíselas al asistente.
        </div>
      </SettingsCard>
    )
  }

  const percent = status && status.totalBytes > 0 ? Math.min(100, Math.round((status.downloadedBytes / status.totalBytes) * 100)) : 0
  const tone: SettingsTone = error || status?.error ? 'error' : status?.downloading ? 'loading' : status?.installed ? 'success' : 'idle'
  const footer = error
    || status?.error
    || (status?.downloading
      ? `Descargando ${gigabytes(status.downloadedBytes)} de ${gigabytes(status.totalBytes)} (${percent} %). Podés seguir usando Notia.`
      : status?.installed
        ? 'Listo: pedile al asistente que dibuje o edite una imagen, en el chat o por Telegram.'
        : status
          ? `Hace falta descargar ${gigabytes(status.totalBytes - status.downloadedBytes)}.`
          : 'Leyendo…')

  return (
    <SettingsCard>
      <SettingsRow
        label="Generación de imágenes"
        description="Qwen-Image 2.1 Turbo (Q4) corre en la placa de video de esta PC: el asistente genera imágenes y edita las de la conversación. En el chat quedan guardadas en el archivo del chat; en Telegram llegan como foto."
        badge={status?.installed ? <SettingsBadge tone="accent">Instalado</SettingsBadge> : null}
        emphasis
      />
      <SettingsRow
        label="Modelos"
        description="Modelo de imagen, codificador de texto y visión, y decodificador, verificados al descargarse. Si se corta, la descarga sigue desde donde quedó."
      >
        <div className="notia-settings-image-models">
          {status?.downloading ? (
            <div
              className="notia-settings-image-progress"
              role="progressbar"
              aria-label="Descarga de los modelos de imágenes"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
          ) : null}
          <div className="notia-settings-image-actions">
            {status?.downloading ? (
              <NotiaButton disabled={busy} onClick={() => { void run(cancelImageModelsDownload, 'No se pudo cancelar la descarga.') }}>
                <X size={14} aria-hidden="true" />Cancelar
              </NotiaButton>
            ) : status && !status.installed ? (
              <NotiaButton disabled={busy || !status.runtimeReady} onClick={() => { void run(downloadImageModels, 'No se pudo iniciar la descarga.') }}>
                <Download size={14} aria-hidden="true" />{status.downloadedBytes > 0 ? 'Seguir descarga' : `Descargar ${gigabytes(status.totalBytes)}`}
              </NotiaButton>
            ) : null}
            {status && !status.downloading && status.downloadedBytes > 0 ? (
              <NotiaButton disabled={busy} onClick={() => { void run(deleteImageModels, 'No se pudieron borrar los modelos.') }}>
                <Trash2 size={14} aria-hidden="true" />Borrar
              </NotiaButton>
            ) : null}
          </div>
        </div>
      </SettingsRow>
      {status && !status.runtimeReady ? (
        <SettingsFooter tone="error" message="Esta instalación no trae el generador (sd-cli). Compilalo con scripts/build-stable-diffusion-runtime.ps1." />
      ) : (
        <SettingsFooter tone={tone} message={footer} />
      )}
    </SettingsCard>
  )
}
