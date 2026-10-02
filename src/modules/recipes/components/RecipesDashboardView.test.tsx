// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { RecipeDetail, RecipeGrid } from '../types/recipesTypes'
import { RecipesDashboardView } from './RecipesDashboardView'

const callBackend = vi.fn()
const layout = vi.hoisted(() => ({ phone: false }))
vi.mock('../../../hooks/useNarrowContainer', () => ({ useNarrowContainer: () => layout.phone }))
vi.mock('../../../services/transport', () => ({
  callBackend: (...args: unknown[]) => callBackend(...args),
  subscribeBackend: () => Promise.resolve(() => undefined),
}))

const LIBRARY = { id: 'lib-1', name: 'gaia', path: 'C:/gaia' }
const macros = [
  { key: 'prot', label: 'Proteína', initial: 'P', gramsLabel: '36 g', percent: 23.8, percentLabel: '24% de las calorías', shortPercentLabel: '24% kcal' },
  { key: 'carb', label: 'Carbohidratos', initial: 'C', gramsLabel: '48 g', percent: 31.7, percentLabel: '32% de las calorías', shortPercentLabel: '32% kcal' },
  { key: 'grasa', label: 'Grasas', initial: 'G', gramsLabel: '30 g', percent: 44.5, percentLabel: '45% de las calorías', shortPercentLabel: '45% kcal' },
] as RecipeDetail['macros']

const GRID: RecipeGrid = {
  total: 1,
  countLabel: '1 receta en tu recetario',
  shortCountLabel: '1 receta',
  filters: [
    { meal: null, label: 'Todas', selected: true },
    { meal: 'breakfast', label: 'Desayuno', selected: false },
    { meal: 'lunch', label: 'Almuerzo', selected: false },
    { meal: 'dinner', label: 'Cena', selected: false },
    { meal: 'snack', label: 'Snack', selected: false },
  ],
  sort: 'recent',
  cards: [{ id: 's1', name: 'Bowl de quinoa', meal: 'lunch', mealLabel: 'Almuerzo', kcalLabel: '610 kcal', minutesLabel: '25 min', macros, hasPhoto: false, photoKey: 's1-1' }],
  empty: null,
}

const DETAIL: RecipeDetail = {
  id: 's1',
  name: 'Bowl de quinoa',
  meal: 'lunch',
  mealLabel: 'Almuerzo',
  description: 'Quinoa tibia con salmón.',
  minutesLabel: '25 min',
  servingsLabel: '2 porciones',
  hasPhoto: false,
  photoKey: 's1-1',
  kcalLabel: '610',
  kcalShareLabel: '31% de una dieta de 2000 kcal',
  macros,
  fiberLabel: '10 g · 36% VD',
  fiberAmountLabel: '10 g',
  fiberDailyLabel: '36% VD',
  sugarLabel: '4 g',
  vitamins: [{ key: 'b12', label: 'Vitamina B12', amountLabel: '3,2 µg', bar: 100, percentLabel: '133% VD', tone: 'over', limit: false }],
  minerals: [{ key: 'sodio', label: 'Sodio', amountLabel: '710 mg', bar: 31, percentLabel: '31% del límite diario, alto', tone: 'limit', limit: true }],
  ingredients: ['1 taza de quinoa'],
  steps: ['Cocinar la quinoa.'],
  aiReviewed: true,
  path: 'recipes/Bowl de quinoa.md',
  form: { name: 'Bowl de quinoa', meal: 'lunch', minutes: 25, servings: 2, description: 'Quinoa tibia con salmón.', ingredients: ['1 taza de quinoa'], steps: ['Cocinar la quinoa.'], nutrition: { kcal: 610 } },
}

function respond(command: string): unknown {
  if (command === 'recipes_grid') return GRID
  if (command === 'recipes_detail') return DETAIL
  if (command === 'recipes_create') return { id: 's9' }
  return null
}

beforeEach(() => {
  layout.phone = false
  callBackend.mockReset()
  callBackend.mockImplementation((command: string) => Promise.resolve(respond(command)))
})

afterEach(() => cleanup())

describe('RecipesDashboardView', () => {
  it('shows the cards and sends the filter, the search and the order to Rust', async () => {
    render(<RecipesDashboardView library={LIBRARY} />)
    expect(await screen.findByText('Bowl de quinoa')).toBeTruthy()
    expect(screen.getByText('1 receta en tu recetario')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cena' }))
    await vi.waitFor(() => expect(callBackend).toHaveBeenCalledWith('recipes_grid', expect.objectContaining({ query: expect.objectContaining({ meal: 'dinner' }) })))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'palta' } })
    await vi.waitFor(() => expect(callBackend).toHaveBeenCalledWith('recipes_grid', expect.objectContaining({ query: expect.objectContaining({ query: 'palta' }) })))
    fireEvent.change(screen.getByRole('combobox', { name: 'Ordenar' }), { target: { value: 'protein' } })
    await vi.waitFor(() => expect(callBackend).toHaveBeenCalledWith('recipes_grid', expect.objectContaining({ query: expect.objectContaining({ sort: 'protein' }) })))
  })

  it('opens the detail with the daily values computed by Rust and deletes after confirming', async () => {
    render(<RecipesDashboardView library={LIBRARY} />)
    fireEvent.click(await screen.findByRole('button', { name: /Bowl de quinoa/ }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText('31% de una dieta de 2000 kcal')).toBeTruthy()
    expect(within(sheet).getByText('31% del límite diario, alto')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Eliminar' }))
    expect(callBackend).not.toHaveBeenCalledWith('recipes_delete', expect.anything())
    fireEvent.click(within(sheet).getByRole('button', { name: 'Confirmar eliminación' }))
    await vi.waitFor(() => expect(callBackend).toHaveBeenCalledWith('recipes_delete', { context: { libraryId: 'lib-1' }, id: 's1' }))
  })

  it('creates a meal through the AI review and shows a repeated dish', async () => {
    render(<RecipesDashboardView library={LIBRARY} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva comida' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/la IA revisa la comida/)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Guiso de lentejas' } })
    fireEvent.change(within(dialog).getByLabelText('Ingredientes'), { target: { value: '2 tazas de lentejas\n1 cebolla' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar receta' })) })
    await vi.waitFor(() => expect(callBackend).toHaveBeenCalledWith('recipes_create', expect.objectContaining({
      input: expect.objectContaining({ name: 'Guiso de lentejas', meal: 'lunch', ingredients: ['2 tazas de lentejas', '1 cebolla'] }),
      photo: null,
    })))

    callBackend.mockImplementation((command: string) => command === 'recipes_create'
      ? Promise.reject({ code: 'duplicate', message: 'Ya tenés esta comida en el recetario: «Bowl de quinoa».', fields: [], duplicateId: 's1' })
      : Promise.resolve(respond(command)))
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva comida' }))
    const again = await screen.findByRole('dialog')
    fireEvent.change(within(again).getByLabelText('Nombre'), { target: { value: 'bowl de quinoa' } })
    await act(async () => { fireEvent.click(within(again).getByRole('button', { name: 'Guardar receta' })) })
    expect(await within(again).findByText(/Ya tenés esta comida/)).toBeTruthy()
    fireEvent.click(within(again).getByRole('button', { name: 'Ver la receta' }))
    await vi.waitFor(() => expect(callBackend).toHaveBeenCalledWith('recipes_detail', { context: { libraryId: 'lib-1' }, id: 's1' }))
  })
})

describe('RecipesDashboardView on a phone', () => {
  beforeEach(() => {
    layout.phone = true
  })

  it('lists the recipes with the count, the filters, the search and the order from Rust', async () => {
    render(<RecipesDashboardView library={LIBRARY} />)
    expect(await screen.findByText('1 receta')).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'palta' } })
    await vi.waitFor(() => expect(callBackend).toHaveBeenCalledWith('recipes_grid', expect.objectContaining({ query: expect.objectContaining({ query: 'palta' }) })))
    // Closing the search clears it.
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(screen.queryByRole('searchbox')).toBeNull()
    await vi.waitFor(() => expect(callBackend).toHaveBeenLastCalledWith('recipes_grid', expect.objectContaining({ query: expect.objectContaining({ query: '' }) })))
    fireEvent.click(screen.getByRole('button', { name: 'Cena' }))
    await vi.waitFor(() => expect(callBackend).toHaveBeenCalledWith('recipes_grid', expect.objectContaining({ query: expect.objectContaining({ meal: 'dinner' }) })))
    fireEvent.change(screen.getByRole('combobox', { name: 'Ordenar' }), { target: { value: 'kcal' } })
    await vi.waitFor(() => expect(callBackend).toHaveBeenCalledWith('recipes_grid', expect.objectContaining({ query: expect.objectContaining({ sort: 'kcal' }) })))
    fireEvent.click(screen.getByRole('button', { name: 'Ver como cuadrícula' }))
    expect(screen.getByRole('button', { name: 'Ver como lista' })).toBeTruthy()
  })

  it('opens the recipe full screen, keeps the checked ingredients and deletes from the sheet after confirming', async () => {
    render(<RecipesDashboardView library={LIBRARY} />)
    fireEvent.click(await screen.findByRole('button', { name: /Bowl de quinoa/ }))
    const page = await screen.findByRole('dialog', { name: 'Bowl de quinoa' })
    expect(within(page).getByText('Por porción, 31% de una dieta de 2000 kcal')).toBeTruthy()
    expect(within(page).getByText('24% kcal')).toBeTruthy()
    expect(within(page).getByText('31% del límite diario, alto')).toBeTruthy()

    fireEvent.click(within(page).getByRole('tab', { name: 'Ingredientes' }))
    expect(within(page).getByText('0 de 1 listos')).toBeTruthy()
    fireEvent.click(within(page).getByRole('button', { name: '1 taza de quinoa' }))
    expect(within(page).getByRole('button', { name: '1 taza de quinoa' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(page).getByText('1 de 1 listos')).toBeTruthy()
    fireEvent.click(within(page).getByRole('tab', { name: 'Preparación' }))
    fireEvent.click(within(page).getByRole('button', { name: /Cocinar la quinoa/ }))
    expect(within(page).getByText('1 de 1 pasos hechos')).toBeTruthy()

    // Back and in again: the checks are still there.
    fireEvent.click(within(page).getByRole('button', { name: 'Volver' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Bowl de quinoa/ }))
    const again = await screen.findByRole('dialog', { name: 'Bowl de quinoa' })
    fireEvent.click(within(again).getByRole('tab', { name: 'Ingredientes' }))
    expect(within(again).getByText('1 de 1 listos')).toBeTruthy()

    fireEvent.click(within(again).getByRole('button', { name: 'Más opciones' }))
    const sheet = screen.getAllByRole('dialog', { name: 'Bowl de quinoa' }).find((dialog) => dialog.classList.contains('rcpm-asheet')) as HTMLElement
    fireEvent.click(within(sheet).getByRole('button', { name: 'Eliminar receta' }))
    expect(callBackend).not.toHaveBeenCalledWith('recipes_delete', expect.anything())
    const confirm = screen.getByRole('dialog', { name: '¿Eliminar “Bowl de quinoa”?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Eliminar receta' }))
    await vi.waitFor(() => expect(callBackend).toHaveBeenCalledWith('recipes_delete', { context: { libraryId: 'lib-1' }, id: 's1' }))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('creates a meal from the full-screen form through the AI review and edits without it', async () => {
    render(<RecipesDashboardView library={LIBRARY} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva comida' }))
    const form = await screen.findByRole('dialog', { name: 'Nueva comida' })
    expect(within(form).getByText(/la IA revisa la comida/)).toBeTruthy()
    fireEvent.change(within(form).getByLabelText('Nombre'), { target: { value: 'Guiso de lentejas' } })
    fireEvent.click(within(form).getByRole('radio', { name: 'Cena' }))
    fireEvent.change(within(form).getByLabelText('Ingredientes'), { target: { value: '2 tazas de lentejas\n1 cebolla' } })
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Guardar' })) })
    await vi.waitFor(() => expect(callBackend).toHaveBeenCalledWith('recipes_create', expect.objectContaining({
      input: expect.objectContaining({ name: 'Guiso de lentejas', meal: 'dinner', ingredients: ['2 tazas de lentejas', '1 cebolla'] }),
      photo: null,
    })))
    // Saved: the recipe opens.
    const page = await screen.findByRole('dialog', { name: 'Bowl de quinoa' })
    fireEvent.click(within(page).getByRole('button', { name: 'Más opciones' }))
    fireEvent.click(screen.getByRole('button', { name: 'Editar receta' }))
    const edit = await screen.findByRole('dialog', { name: 'Editar receta' })
    expect(within(edit).queryByText(/la IA revisa la comida/)).toBeNull()
    expect((within(edit).getByLabelText('Nombre') as HTMLInputElement).value).toBe('Bowl de quinoa')
    await act(async () => { fireEvent.click(within(edit).getByRole('button', { name: 'Guardar' })) })
    await vi.waitFor(() => expect(callBackend).toHaveBeenCalledWith('recipes_update', expect.objectContaining({ id: 's1', photo: { kind: 'keep' } })))
  })

  it('shows a repeated dish with a link to it and the name error from Rust', async () => {
    callBackend.mockImplementation((command: string) => command === 'recipes_create'
      ? Promise.reject({ code: 'duplicate', message: 'Ya tenés esta comida en el recetario: «Bowl de quinoa».', fields: [], duplicateId: 's1' })
      : Promise.resolve(respond(command)))
    render(<RecipesDashboardView library={LIBRARY} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva comida' }))
    const form = await screen.findByRole('dialog', { name: 'Nueva comida' })
    fireEvent.change(within(form).getByLabelText('Nombre'), { target: { value: 'bowl de quinoa' } })
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Guardar' })) })
    expect(await within(form).findByText(/Ya tenés esta comida/)).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Ver la receta' }))
    expect(await screen.findByRole('dialog', { name: 'Bowl de quinoa' })).toBeTruthy()

    callBackend.mockImplementation((command: string) => command === 'recipes_create'
      ? Promise.reject({ code: 'validation', message: 'Revisá los datos.', fields: [{ field: 'name', message: 'Escribí un nombre para guardar la receta.' }], duplicateId: null })
      : Promise.resolve(respond(command)))
    fireEvent.click(screen.getByRole('button', { name: 'Nueva comida' }))
    const empty = await screen.findByRole('dialog', { name: 'Nueva comida' })
    await act(async () => { fireEvent.click(within(empty).getByRole('button', { name: 'Guardar' })) })
    expect(await within(empty).findByText('Escribí un nombre para guardar la receta.')).toBeTruthy()
    expect(within(empty).getByPlaceholderText('Ej: Tarta de zapallitos').getAttribute('aria-invalid')).toBe('true')
  })
})
