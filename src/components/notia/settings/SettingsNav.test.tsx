// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SettingsNav } from './SettingsNav'
import { matchesSettingsSearch, SETTINGS_SECTIONS } from './settingsSections'

describe('matchesSettingsSearch', () => {
  it('matches titles, groups, descriptions and keywords without accents', () => {
    expect(matchesSettingsSearch('IA', 'api key')).toBe(true)
    expect(matchesSettingsSearch('Voz', 'sintesis')).toBe(true)
    expect(matchesSettingsSearch('Usuarios', 'ACCESO')).toBe(true)
    expect(matchesSettingsSearch('Backups', 'ollama')).toBe(false)
    expect(matchesSettingsSearch('General', '   ')).toBe(true)
  })
})

describe('SettingsNav', () => {
  afterEach(cleanup)

  it('filters the sections, marks the active one and picks another', () => {
    const onPick = vi.fn()
    const onQueryChange = vi.fn()
    const { rerender } = render(
      <SettingsNav sections={SETTINGS_SECTIONS} active="General" query="" footer="Notia v1 · Windows" onQueryChange={onQueryChange} onPick={onPick} />,
    )
    expect(screen.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: 'Telegram' }))
    expect(onPick).toHaveBeenCalledWith('Telegram')

    rerender(
      <SettingsNav sections={SETTINGS_SECTIONS} active="General" query="token" footer="Notia v1 · Windows" onQueryChange={onQueryChange} onPick={onPick} />,
    )
    expect(screen.getByRole('button', { name: 'Telegram' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'General' })).toBeNull()

    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Buscar ajuste' }), { key: 'Escape' })
    expect(onQueryChange).toHaveBeenCalledWith('')

    rerender(
      <SettingsNav sections={SETTINGS_SECTIONS} active="General" query="zzz" footer="Notia v1 · Windows" onQueryChange={onQueryChange} onPick={onPick} />,
    )
    expect(screen.getByText('Sin resultados para «zzz».')).toBeTruthy()
  })

  it('hides the sections the platform does not offer', () => {
    render(
      <SettingsNav sections={SETTINGS_SECTIONS.filter((section) => section !== 'Backups')} active="General" query="" footer="" onQueryChange={() => {}} onPick={() => {}} />,
    )
    expect(screen.queryByRole('button', { name: 'Backups' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeTruthy()
  })
})
