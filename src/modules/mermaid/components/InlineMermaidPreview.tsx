import { memo, useRef } from 'react'
import { Provider } from 'react-redux'
import { store } from '../../../store'
import { useAppSelector } from '../../../store/hooks'
import { selectTheme } from '../../../features/preferences/preferencesSelectors'
import { useMermaidLazyRender } from '../hooks/useMermaidLazyRender'
import { MermaidCanvas } from './MermaidCanvas'
import '../styles/mermaid.css'

interface InlineMermaidPreviewProps {
  code: string
  storageKey: string
}

function InlineMermaidPreviewInner({ code }: Omit<InlineMermaidPreviewProps, 'storageKey'>) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const appTheme = useAppSelector(selectTheme)
  const theme = appTheme === 'dark' ? 'dark' : 'default'

  const { result, error, isLoading } = useMermaidLazyRender({
    code,
    theme,
    containerRef,
  })

  return (
    <div ref={containerRef} className="notia-mermaid-inline-host">
      <MermaidCanvas
        result={result}
        isLoading={isLoading}
        error={error}
        gridEnabled={false}
        panZoomEnabled={true}
        theme={theme}
        roughEnabled={false}
        initialZoom={1}
        initialPanX={0}
        initialPanY={0}
        readOnly={true}
      />
    </div>
  )
}

const MemoizedInner = memo(InlineMermaidPreviewInner)

export function InlineMermaidPreview(props: InlineMermaidPreviewProps) {
  return (
    <Provider store={store}>
      <MemoizedInner {...props} />
    </Provider>
  )
}
