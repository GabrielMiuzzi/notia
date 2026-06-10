import { memo } from 'react'
import { Provider } from 'react-redux'
import { store } from '../../../store'
import { useAppSelector } from '../../../store/hooks'
import type { RootState } from '../../../store/hooks'
import { useMermaidRender } from '../hooks/useMermaidRender'
import { MermaidCanvas } from './MermaidCanvas'

interface InlineMermaidPreviewProps {
  code: string
}

function InlineMermaidPreviewInner({ code }: InlineMermaidPreviewProps) {
  const appTheme = useAppSelector((state: RootState) => state.preferences.theme)
  const theme = appTheme === 'dark' ? 'dark' : 'default'

  const { result, error, isLoading } = useMermaidRender({
    code,
    theme,
  })

  return (
    <div className="notia-mermaid-inline-host">
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
