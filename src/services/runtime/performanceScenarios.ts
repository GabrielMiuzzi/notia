export interface PerformanceScenario {
  id: 'small' | 'large' | 'deep'
  description: string
  approximateEntries: number
  approximateMaxDepth: number
}

/** Reproducible fixture targets for profiling without retaining user data. */
export const PERFORMANCE_SCENARIOS: readonly PerformanceScenario[] = [
  {
    id: 'small',
    description: 'Biblioteca pequeña con carpetas y archivos mixtos.',
    approximateEntries: 500,
    approximateMaxDepth: 8,
  },
  {
    id: 'large',
    description: 'Biblioteca grande con muchas carpetas y archivos.',
    approximateEntries: 100_000,
    approximateMaxDepth: 32,
  },
  {
    id: 'deep',
    description: 'Biblioteca con una estructura profundamente anidada.',
    approximateEntries: 10_000,
    approximateMaxDepth: 1_000,
  },
] as const
