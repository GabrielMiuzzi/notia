// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { RecipeDetail, RecipeGrid } from '../types/recipesTypes'
import { RecipesDashboardView } from './RecipesDashboardView'

const callBackend = vi.fn()
vi.mock('../../../services/transport', () => ({
  callBackend: (...args: unknown[]) => callBackend(...args),
  subscribeBackend: () => Promise.resolve(() => undefined),
}))

const LIBRARY = { id: 'lib-1', name: 'gaia', path: 'C:/gaia' }
const macros = [
  { key: 'prot', label: 'Proteína', initial: 'P', gramsLabel: '36 g', percent: 23.8, percentLabel: '24% de las calorías' },
  { key: 'carb', label: 'Carbohidratos', initial: 'C', gramsLabel: '48 g', percent: 31.7, percentLabel: '32% de las calorías' },
  { key: 'grasa', label: 'Grasas', initial: 'G', gramsLabel: '30 g', percent: 44.5, percentLabel: '45% de las calorías' },
] as RecipeDetail['macros']

const GRID: RecipeGrid = {
  total: 1,
  countLabel: '1 receta en tu recetario',
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
