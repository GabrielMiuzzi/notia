// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ImageModelsStatus } from '../../../services/ai/imageModelsService'

const service = vi.hoisted(() => ({
  imageModelsSupported: vi.fn(() => true),
  getImageModelsStatus: vi.fn(),
  downloadImageModels: vi.fn(),
  cancelImageModelsDownload: vi.fn(),
  deleteImageModels: vi.fn(),
}))

vi.mock('../../../services/ai/imageModelsService', () => service)

const { ImageModelsSection } = await import('./ImageModelsSection')

const TOTAL = 11_323_751_736
const status = (patch: Partial<ImageModelsStatus>): ImageModelsStatus => ({
  supported: true,
  runtimeReady: true,
  installed: false,
  totalBytes: TOTAL,
  downloadedBytes: 0,
  downloading: false,
  error: null,
  ...patch,
})

describe('ImageModelsSection', () => {
  beforeEach(() => {
    Object.values(service).forEach((mock) => mock.mockReset())
    service.imageModelsSupported.mockReturnValue(true)
  })

  afterEach(cleanup)

  it('offers the download and shows its progress', async () => {
    service.getImageModelsStatus.mockResolvedValue(status({}))
    service.downloadImageModels.mockResolvedValue(status({ downloading: true, downloadedBytes: TOTAL / 4 }))
    render(<ImageModelsSection />)
    fireEvent.click(await screen.findByRole('button', { name: /Descargar 11,3 GB/ }))
    await waitFor(() => expect(service.downloadImageModels).toHaveBeenCalledTimes(1))
    expect((await screen.findByRole('progressbar', { name: 'Descarga de los modelos de imágenes' })).getAttribute('aria-valuenow')).toBe('25')
    expect(screen.getByRole('button', { name: /Cancelar/ })).toBeTruthy()
    expect(screen.getByText(/Descargando 2,8 GB de 11,3 GB \(25 %\)/)).toBeTruthy()
  })

  it('resumes a partial download and shows the backend error', async () => {
    service.getImageModelsStatus.mockResolvedValue(status({ downloadedBytes: 4_201_694_944, error: 'Se cortó la descarga.' }))
    render(<ImageModelsSection />)
    expect(await screen.findByRole('button', { name: /Seguir descarga/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Borrar/ })).toBeTruthy()
    expect(screen.getByText('Se cortó la descarga.')).toBeTruthy()
  })

  it('shows the installed models and lets them be deleted', async () => {
    service.getImageModelsStatus.mockResolvedValue(status({ installed: true, downloadedBytes: TOTAL }))
    service.deleteImageModels.mockResolvedValue(status({}))
    render(<ImageModelsSection />)
    expect(await screen.findByText('Instalado')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Descargar/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Borrar/ }))
    await waitFor(() => expect(service.deleteImageModels).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('button', { name: /Descargar 11,3 GB/ })).toBeTruthy()
  })

  it('explains that images are made on the Windows PC', async () => {
    service.getImageModelsStatus.mockResolvedValue(status({ supported: false }))
    render(<ImageModelsSection />)
    expect(await screen.findByText(/se generan en la PC con Windows/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('needs sd-cli in the installation', async () => {
    service.getImageModelsStatus.mockResolvedValue(status({ runtimeReady: false }))
    render(<ImageModelsSection />)
    expect(await screen.findByText(/no trae el generador/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /Descargar/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
