import { useAppSelector } from '../../../store/hooks'
import { selectTheme } from '../../../features/preferences/preferencesSelectors'
import { useMermaidRender } from '../../mermaid/hooks/useMermaidRender'

/** Nodos más juntos que el diagrama por defecto: el flujo crece hacia abajo. */
const COMPACT_FLOWCHART = JSON.stringify({ flowchart: { nodeSpacing: 24, rankSpacing: 28, padding: 8 } })

/**
 * El flujo de la tarea: el diagrama Mermaid que arma Rust, con el tema de la
 * app. Cada nodo trae la clase de su estado y la hoja de estilos lo colorea
 * con los tokens del tema.
 */
export function AiTaskWorkflowGraph({ code }: { code: string }) {
  const appTheme = useAppSelector(selectTheme)
  const { result, error } = useMermaidRender({ code, config: COMPACT_FLOWCHART, theme: appTheme === 'light' ? 'light' : 'dark' })

  if (error) {
    return <pre className="ait-graph__fallback" aria-label="Flujo de la tarea">{code}</pre>
  }
  if (!result?.svg) {
    return <div className="ait-graph ait-graph--loading" role="status">Dibujando el flujo…</div>
  }
  return (
    <div
      className="ait-graph"
      role="img"
      aria-label="Flujo de la tarea: plan, pasos y revisiones"
      // The SVG comes from Mermaid's renderer over a diagram Rust wrote.
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  )
}
