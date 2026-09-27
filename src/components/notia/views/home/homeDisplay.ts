// How Home writes the counts and percents Rust sends. Presentation only.

/** «1 evento», «3 eventos». */
export function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** «76 %», or «—» without data. */
export function percentLabel(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value} %`
}
