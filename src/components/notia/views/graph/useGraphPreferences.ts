import { useEffect, useState } from 'react'

/*
 * How the person likes to see the graph on this device: names, orphans,
 * folder halos and the forces of the layout. A viewing convenience, so it
 * lives in the WebView storage and falls back to the defaults.
 */

const STORAGE_KEY = 'notia.graphView.preferences.v2'

export type GraphLabelMode = 'auto' | 'all'

export interface GraphForces {
  /** Strength of the repulsion between notes (d3 `charge`, negated). */
  repulsion: number
  /** Length of a link (d3 `link` distance). */
  linkDistance: number
  /** Pull toward the folder's center, in hundredths. */
  cohesion: number
}

export interface GraphPreferences {
  labels: GraphLabelMode
  showOrphans: boolean
  showFolders: boolean
  forces: GraphForces
}

export const DEFAULT_GRAPH_FORCES: GraphForces = { repulsion: 120, linkDistance: 45, cohesion: 10 }

export const GRAPH_FORCE_LIMITS: Record<keyof GraphForces, [number, number]> = {
  repulsion: [30, 300],
  linkDistance: [20, 120],
  cohesion: [0, 30],
}

/** The forces as the view and the phone sheet list them, with how each value reads. */
export const GRAPH_FORCE_ROWS: Array<{ key: keyof GraphForces; name: string; format: (value: number) => string }> = [
  { key: 'repulsion', name: 'Repulsión', format: (value) => `−${value}` },
  { key: 'linkDistance', name: 'Distancia de enlace', format: (value) => String(value) },
  { key: 'cohesion', name: 'Cohesión por carpeta', format: (value) => (value / 100).toFixed(2) },
]

/** Whether the person changed the view from its defaults (the phone header marks it). */
export function hasCustomGraphView(preferences: GraphPreferences): boolean {
  return preferences.labels !== 'auto'
    || !preferences.showOrphans
    || (Object.keys(DEFAULT_GRAPH_FORCES) as Array<keyof GraphForces>).some((key) => preferences.forces[key] !== DEFAULT_GRAPH_FORCES[key])
}

const DEFAULT_PREFERENCES: GraphPreferences = {
  labels: 'auto',
  showOrphans: true,
  showFolders: true,
  forces: DEFAULT_GRAPH_FORCES,
}

function clampForce(key: keyof GraphForces, value: unknown): number {
  const [min, max] = GRAPH_FORCE_LIMITS[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : DEFAULT_GRAPH_FORCES[key]
}

function readPreferences(): GraphPreferences {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<GraphPreferences> | null
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PREFERENCES
    const forces = (parsed.forces ?? {}) as Partial<GraphForces>
    return {
      labels: parsed.labels === 'all' ? 'all' : 'auto',
      showOrphans: parsed.showOrphans !== false,
      showFolders: parsed.showFolders !== false,
      forces: {
        repulsion: clampForce('repulsion', forces.repulsion),
        linkDistance: clampForce('linkDistance', forces.linkDistance),
        cohesion: clampForce('cohesion', forces.cohesion),
      },
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function useGraphPreferences() {
  const [preferences, setPreferences] = useState<GraphPreferences>(readPreferences)
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
    } catch {
      // Storage may be off in some WebViews; the defaults still work.
    }
  }, [preferences])
  const update = (change: Partial<GraphPreferences>) => setPreferences((current) => ({ ...current, ...change }))
  return { preferences, update }
}
