import { useEffect } from 'react'
import { getRuntimeDevice } from '../../../utils/platform/getRuntimeDevice'
import { preloadLazyComponent, preloadLazyComponentSequence } from '../../../services/runtime/lazyPreloadRuntime'

/**
 * Hook that preloads heavy editor modules when the app is idle.
 * On desktop it warms up Markdown and Mermaid editors so that
 * opening the first file feels instant. On Android the preload is skipped
 * by default to avoid consuming memory and mobile data unnecessarily.
 */
export function useLazyPreloadOnIdle() {
  useEffect(() => {
    const isAndroid = getRuntimeDevice() === 'Android'
    if (isAndroid) {
      return
    }

    // Preload the most common editors first, then the rest.
    preloadLazyComponentSequence(
      [
        {
          key: 'MarkdownView',
          factory: () => import('../views/MarkdownView'),
        },
        {
          key: 'MermaidView',
          factory: () => import('../views/mermaid/MermaidView'),
        },
      ],
      { delayMs: 1500, gapMs: 400 },
    )

    // Workspace-level heavy views are loaded later and only if idle allows it.
    preloadLazyComponent(
      'GraphView',
      () => import('../views/GraphView'),
      { delayMs: 3500 },
    )
    preloadLazyComponent(
      'TaskManagerApp',
      () => import('../../../modules/task-manager/components/TaskManagerApp'),
      { delayMs: 4500 },
    )
  }, [])
}
