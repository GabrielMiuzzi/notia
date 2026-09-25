// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import preferencesReducer, { hydrateDevicePreferences } from '../../../features/preferences/preferencesSlice'
import type { DevicePreferences } from '../../../services/preferences/devicePreferencesStorage'
import { EditorSettingsModal, type EditorSettingsTab } from './EditorSettingsModal'
import { MarkdownDocumentMenu } from '../MarkdownDocumentMenu'

const saveDevicePreferences = vi.fn()
vi.mock('../../../services/preferences/devicePreferencesStorage', () => ({
  saveDevicePreferences: (...args: unknown[]) => saveDevicePreferences(...args),
}))

const SETUP = {
  formats: [
    { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297 },
    { id: 'a5', label: 'A5', widthMm: 148, heightMm: 210 },
  ],
  margins: [
    { id: 'narrow', label: 'Estrechos', marginMm: 12.7 },
    { id: 'normal', label: 'Normales', marginMm: 25.4 },
  ],
  widthMm: 210,
  heightMm: 297,
  marginMm: 25.4,
  pageNumbers: true,
  canExportPdf: false,
} as DevicePreferences['editorPageSetup']

const PREFERENCES = {
  editorPage: { pageMode: false, format: 'a4', orientation: 'portrait', margins: 'normal', pageNumbers: true },
  pen: { tool: 'fountain', color: 'ink', thickness: 3, smoothing: 40, pressure: true, palmRejection: true, penOnly: false, sideButton: 'eraser' },
  editorPageSetup: SETUP,
} as unknown as DevicePreferences

function renderModal(tab: EditorSettingsTab = 'page') {
  const store = configureStore({ reducer: { preferences: preferencesReducer } })
  store.dispatch(hydrateDevicePreferences(PREFERENCES))
  const onTabChange = vi.fn()
  render(
    <Provider store={store}>
      <EditorSettingsModal open tab={tab} onTabChange={onTabChange} onClose={vi.fn()} />
    </Provider>,
  )
  return { store, onTabChange }
}

describe('EditorSettingsModal', () => {
  beforeEach(() => {
    saveDevicePreferences.mockReset()
    saveDevicePreferences.mockImplementation(async (sections: Partial<DevicePreferences>) => ({ ...PREFERENCES, ...sections }))
  })
  afterEach(cleanup)

  it('turns page mode on and saves the page setup in the backend', async () => {
    const { store } = renderModal()
    expect(screen.getByRole('radio', { name: /A4/ }).getAttribute('aria-checked')).toBe('true')

    fireEvent.click(screen.getByRole('switch', { name: 'Modo página' }))
    expect(store.getState().preferences.editorPage?.pageMode).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /A5/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'Horizontal' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Estrechos' }))

    await waitFor(() => expect(saveDevicePreferences).toHaveBeenCalledTimes(4))
    expect(saveDevicePreferences).toHaveBeenLastCalledWith({
      editorPage: { pageMode: true, format: 'a5', orientation: 'landscape', margins: 'narrow', pageNumbers: true },
    })
  })

  it('restores the previous value and says so when the backend refuses it', async () => {
    saveDevicePreferences.mockRejectedValueOnce(new Error('disk full'))
    const { store } = renderModal()
    fireEvent.click(screen.getByRole('switch', { name: 'Mostrar número de página' }))
    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo guardar')
    expect(store.getState().preferences.editorPage?.pageNumbers).toBe(true)
  })

  it('keeps the pen settings for the pen to come', async () => {
    renderModal('pen')
    expect(screen.getByText('Próximamente')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Marcador' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Teal' }))
    fireEvent.change(screen.getByRole('slider', { name: /Grosor/ }), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Dibujar solo con lápiz' }))
    await waitFor(() => expect(saveDevicePreferences).toHaveBeenCalledTimes(4))
    expect(saveDevicePreferences).toHaveBeenLastCalledWith({
      pen: expect.objectContaining({ tool: 'marker', color: 'teal', thickness: 8, penOnly: true }),
    })
  })

  it('switches sections from the navigation', () => {
    const { onTabChange } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Lápiz' }))
    expect(onTabChange).toHaveBeenCalledWith('pen')
  })
})

describe('MarkdownDocumentMenu', () => {
  afterEach(cleanup)

  function renderMenu(pageMode: boolean | null = false) {
    const handlers = {
      onTogglePageMode: vi.fn(),
      onOpenPageSettings: vi.fn(),
      onOpenPenSettings: vi.fn(),
      onExport: vi.fn(),
    }
    render(<MarkdownDocumentMenu pageMode={pageMode} pageSizeLabel={pageMode ? 'A4' : 'Continuo'} canExportPdf={pageMode === true} exportingFormat={null} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Más opciones' }))
    return handlers
  }

  it('toggles page mode without closing and opens the settings', () => {
    const handlers = renderMenu()
    const toggle = screen.getByRole('menuitemcheckbox', { name: /Modo página/ })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(handlers.onTogglePageMode).toHaveBeenCalled()
    expect(screen.getByRole('menuitem', { name: /Tamaño de página/ }).textContent).toContain('Continuo')

    fireEvent.click(screen.getByRole('menuitem', { name: /Lápiz/ }))
    expect(handlers.onOpenPenSettings).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('exports to PDF and Word', () => {
    const handlers = renderMenu(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Exportar como PDF' }))
    expect(handlers.onExport).toHaveBeenCalledWith('pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Más opciones' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Exportar como Word' }))
    expect(handlers.onExport).toHaveBeenCalledWith('google-docs')
  })

  it('offers the PDF only in page mode, and Word always', () => {
    const handlers = renderMenu(false)
    const pdf = screen.getByRole('menuitem', { name: /Exportar como PDF/ }) as HTMLButtonElement
    expect(pdf.disabled).toBe(true)
    expect(pdf.textContent).toContain('Requiere modo página')
    fireEvent.click(pdf)
    expect(handlers.onExport).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Exportar como Word' }))
    expect(handlers.onExport).toHaveBeenCalledWith('google-docs')
  })

  it('waits for the preferences before offering page mode', () => {
    renderMenu(null)
    expect((screen.getByRole('menuitemcheckbox', { name: /Modo página/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
