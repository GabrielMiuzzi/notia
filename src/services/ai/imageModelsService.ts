import { backendSupports, callBackend } from '../transport'

/** Estado de los modelos de imágenes de este dispositivo (`app/src/image_generation.rs`). */
export interface ImageModelsStatus {
  /** Este dispositivo genera imágenes (Windows). */
  supported: boolean
  /** `sd-cli` está empaquetado con la app. */
  runtimeReady: boolean
  /** Todos los archivos del modelo están descargados y completos. */
  installed: boolean
  totalBytes: number
  downloadedBytes: number
  downloading: boolean
  error: string | null
}

export function imageModelsSupported(): boolean {
  return backendSupports('backend_image_models_status')
}

export function getImageModelsStatus(): Promise<ImageModelsStatus> {
  return callBackend<ImageModelsStatus>('backend_image_models_status')
}

export function downloadImageModels(): Promise<ImageModelsStatus> {
  return callBackend<ImageModelsStatus>('backend_download_image_models')
}

export function cancelImageModelsDownload(): Promise<ImageModelsStatus> {
  return callBackend<ImageModelsStatus>('backend_cancel_image_models_download')
}

export function deleteImageModels(): Promise<ImageModelsStatus> {
  return callBackend<ImageModelsStatus>('backend_delete_image_models')
}
