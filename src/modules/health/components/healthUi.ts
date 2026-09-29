import { Apple, Coffee, Cookie, Moon, Salad, type LucideIcon } from 'lucide-react'

/** Un número escrito en el formulario («82,4»); Rust valida el rango. */
export function toNumber(value: string): number | null {
  const text = value.trim().replace(',', '.')
  if (!text) return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

const CATEGORY_ICONS: Record<string, LucideIcon> = { desayuno: Coffee, snack: Apple, almuerzo: Salad, merienda: Cookie, cena: Moon }

export function categoryIcon(category: string): LucideIcon {
  return CATEGORY_ICONS[category] ?? Salad
}
