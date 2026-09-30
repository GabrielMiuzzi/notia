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
  formats: [{ id: 'a4', label: 'A4', widthMm: 210, heightMm: 297 }],
  margins: [
    { id: 'narrow', label: 'Estrechos', marginMm: 12.7 },
    { id: 'normal', label: 'Normales', marginMm: 25.4 },
  ],
  widthMm: 210,
  heightMm: 297,
  marginMm: 25.4,
  pageNumbers: true,
} as DevicePreferences['editorPageSetup']

const PREFERENCES = {
  editorPage: { format: 'a4', orientation: 'portrait', margins: 'normal', pageNumbers: true },
  pen: { color: 'ink', thickness: 4, smoothing: 40, pressure: true, palmRejection: true, penOnly: false, sideButton: 'eraser' },
  editorPageSetup: SETUP,
} as unknown as DevicePreferences

function renderModal(tab: EditorSettingsTab = 'page', pageMode: boolean | null = false) {
  const store = configureStore({ reducer: { preferences: preferencesReducer } })
  store.dispatch(hydrateDevicePreferences(PREFERENCES))
  const onTabChange = vi.fn()
  const onTogglePageMode = vi.fn()
  render(
    <Provider store={store}>
      <EditorSettingsModal open tab={tab} onTabChange={onTabChange} onClose={vi.fn()} pageMode={pageMode} onTogglePageMode={onTogglePageMode} />
    </Provider>,
  )
  return { store, onTabChange, onTogglePageMode }
}

describe('EditorSettingsModal', () => {
  beforeEach(() => {
    saveDevicePreferences.mockReset()
    saveDevicePreferences.mockImplementation(async (sections: Partial<DevicePreferences>) => ({ ...PREFERENCES, ...sections }))
  })
  afterEach(cleanup)

  it('turns page mode on for the note and saves the page setup in the backend', async () => {
    const { onTogglePageMode } = renderModal()
    expect(screen.getByRole('radio', { name: /A4/ }).getAttribute('aria-checked')).toBe('true')

    // Page mode is the note's property: the switch asks the note to change, not the device.
    fireEvent.click(screen.getByRole('switch', { name: 'Modo página' }))
    expect(onTogglePageMode).toHaveBeenCalled()
    // A4 is the only size.
    expect(screen.getAllByRole('radio', { name: /× .* mm/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('radio', { name: 'Horizontal' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Estrechos' }))

    await waitFor(() => expect(saveDevicePreferences).toHaveBeenCalledTimes(2))
    expect(saveDevicePreferences).toHaveBeenLastCalledWith({
      editorPage: { format: 'a4', orientation: 'landscape', margins: 'narrow', pageNumbers: true },
    })
  })

  it('shows the note in page mode and needs a note to turn it on', () => {
    renderModal('page', true)
    expect((screen.getByRole('switch', { name: 'Modo página' }) as HTMLInputElement).checked).toBe(true)
    cleanup()
    renderModal('page', null)
    expect((screen.getByRole('switch', { name: 'Modo página' }) as HTMLInputElement).disabled).toBe(true)
  })

  it('restores the previous value and says so when the backend refuses it', async () => {
    saveDevicePreferences.mockRejectedValueOnce(new Error('disk full'))
    const { store } = renderModal()
    fireEvent.click(screen.getByRole('switch', { name: 'Mostrar número de página' }))
    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo guardar')
    expect(store.getState().preferences.editorPage?.pageNumbers).toBe(true)
  })

  it('has only the page section: the pen options are in the pen bar', () => {
    renderModal()
    expect(screen.queryByRole('button', { name: 'Lápiz' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Página' })).toBeTruthy()
  })
})

describe('MarkdownDocumentMenu', () => {
  afterEach(cleanup)

  function renderMenu(pageMode: boolean | null = false) {
    const handlers = {
      onTogglePageMode: vi.fn(),
      onOpenPageSettings: vi.fn(),
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

    expect(screen.queryByRole('menuitem', { name: /Lápiz/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /Configuración/ }))
    expect(handlers.onOpenPageSettings).toHaveBeenCalled()
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
