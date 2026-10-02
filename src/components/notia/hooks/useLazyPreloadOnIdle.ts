import { useEffect } from 'react'
import { useAppSelector, type RootState } from '../../../store/hooks'
import { selectActiveDocument } from '../../../features/documents/documentsSelectors'
import { shouldUseLargeMarkdownView } from '../../../engines/markdown/markdownEditorLimits'
import { getRuntimeDevice } from '../../../utils/platform/getRuntimeDevice'
import { preloadLazyComponent, preloadLazyComponentSequence } from '../../../services/runtime/lazyPreloadRuntime'

/**
 * Hook that preloads heavy editor modules when the app is idle.
 * On desktop it warms up Markdown and Mermaid editors so that
 * opening the first file feels instant. On Android the preload is skipped
 * by default to avoid consuming memory and mobile data unnecessarily.
 */
/** Only the answer is selected: the open note's text changes on every pause in typing. */
function selectShouldSkipMarkdownPreload(state: RootState): boolean {
  const activeDocument = selectActiveDocument(state)
  return activeDocument?.viewKind === 'markdown' && shouldUseLargeMarkdownView(activeDocument.source)
}

export function useLazyPreloadOnIdle() {
  const shouldSkipMarkdownPreload = useAppSelector(selectShouldSkipMarkdownPreload)

  useEffect(() => {
    const isAndroid = getRuntimeDevice() === 'Android'
    if (isAndroid) {
      return
    }

    // A large document uses the lightweight text route. Cancel the pending
    // Milkdown preload so it cannot compete with that first paint.
    // Preload the most common editors first, then the rest.
    const cancelEditorPreload = preloadLazyComponentSequence(
      [
        ...(shouldSkipMarkdownPreload ? [] : [{
          key: 'MarkdownView',
          factory: () => import('../views/MarkdownView'),
        }]),
        {
          key: 'MermaidView',
          factory: () => import('../views/mermaid/MermaidView'),
        },
      ],
      { delayMs: 1500, gapMs: 400 },
    )

    // Workspace-level heavy views are loaded later and only if idle allows it.
    const cancelGraphPreload = preloadLazyComponent(
      'GraphView',
      () => import('../views/GraphView'),
      { delayMs: 3500 },
    )
    const cancelTaskManagerPreload = preloadLazyComponent(
      'TaskManagerApp',
      () => import('../../../modules/task-manager/components/TaskManagerApp'),
      { delayMs: 4500 },
    )
    return () => {
      cancelEditorPreload()
      cancelGraphPreload()
      cancelTaskManagerPreload()
    }
  }, [shouldSkipMarkdownPreload])
}
