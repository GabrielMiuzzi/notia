import { Apple, Coffee, Cookie, Moon, Salad, type LucideIcon } from 'lucide-react'

/** Un número escrito en el formulario («82,4»); Rust valida el rango. */
export function toNumber(value: string): number | null {
  const text = value.trim().replace(',', '.')
  if (!text) return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

/** Los textos de un registro diario; los valores y el histórico los arma Rust. */
export interface DailyPanelCopy {
  id: 'steps' | 'sleep'
  title: string
  /** Unidad junto al número grande, si el valor no la trae. */
  unit: string | null
  inputLabel: string
  placeholder: string
  addLabel: string
  /** «los pasos», «el sueño»: para el botón de eliminar. */
  recordName: string
}

export const STEPS_COPY: DailyPanelCopy = {
  id: 'steps',
  title: 'Pasos',
  unit: 'pasos',
  inputLabel: 'Pasos',
  placeholder: '8.000',
  addLabel: 'Agregar pasos',
  recordName: 'los pasos',
}

export const SLEEP_COPY: DailyPanelCopy = {
  id: 'sleep',
  title: 'Sueño',
  unit: null,
  inputLabel: 'Horas',
  placeholder: '7:30',
  addLabel: 'Agregar sueño',
  recordName: 'el sueño',
}

const CATEGORY_ICONS: Record<string, LucideIcon> = { desayuno: Coffee, snack: Apple, almuerzo: Salad, merienda: Cookie, cena: Moon }

export function categoryIcon(category: string): LucideIcon {
  return CATEGORY_ICONS[category] ?? Salad
}
