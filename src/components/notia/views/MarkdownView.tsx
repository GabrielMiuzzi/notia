import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useAppSelector } from '../../../store/hooks'
import { selectTheme } from '../../../features/preferences/preferencesSelectors'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { replaceAll } from '@milkdown/kit/utils'
import { gfm } from '@milkdown/preset-gfm'
import { emoji } from '@milkdown/plugin-emoji'
import { cursor } from '@milkdown/plugin-cursor'
import { indent } from '@milkdown/plugin-indent'
import { trailing } from '@milkdown/plugin-trailing'
import { clipboard } from '@milkdown/plugin-clipboard'
import { codeBlockConfig } from '@milkdown/kit/component/code-block'
import { commandsCtx } from '@milkdown/kit/core'
import {
  codeBlockSchema,
  clearTextInCurrentBlockCommand,
  setBlockTypeCommand,
} from '@milkdown/kit/preset/commonmark'
import {
  parseFrontmatterDocument,
  serializeFrontmatterDocument,
  type FrontmatterEntry,
} from '../../../engines/markdown/frontmatterEngine'
import {
  buildWikiLinkLookup,
  searchWikiLinkTargets,
  type MarkdownWikiLinkLookup,
} from '../../../engines/markdown/wikiLinkEngine'
import {
  syncPageLink,
} from '../../../engines/markdown/pageLinkSyncEngine'
import {
  readLibraryFileContent,
  writeLibraryFileContent,
} from '../../../services/libraries/libraryDocumentRuntime'
import type { MarkdownWikiLinkTarget } from '../../../types/views/markdownWikiLink'
import { MarkdownPropertiesPanel } from './MarkdownPropertiesPanel'
import {
  WikiLinkSuggestionMenu,
  type WikiLinkSuggestionMenuState,
} from './markdown/WikiLinkSuggestionMenu'
import { createWikiLinkPlugin, type WikiLinkMenuContext } from './markdown/wikiLinkPlugin'
import { useMarkdownZoom } from './markdown/useMarkdownZoom'
import { quickHash } from '../../../modules/mermaid/engines/mermaidEngine'
import { mountInlineMermaidPreview, unmountInlineMermaidPreview } from '../../../modules/mermaid/services/mermaidPreviewRuntime'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/nord.css'

const WIKI_LINK_MENU_WIDTH = 320
const WIKI_LINK_MENU_MARGIN = 12

interface MarkdownViewProps {
  source: string
  documentPath: string
  onSourceChange: (nextSource: string) => void
  wikiLinkTargets: MarkdownWikiLinkTarget[]
  onOpenLinkedFile: (filePath: string) => void
  theme?: string
  zoom: number
  onZoomChange: (zoom: number) => void
}

function clampWikiLinkMenuLeft(left: number): number {
  const maxLeft = Math.max(WIKI_LINK_MENU_MARGIN, window.innerWidth - WIKI_LINK_MENU_WIDTH - WIKI_LINK_MENU_MARGIN)
  return Math.min(Math.max(left, WIKI_LINK_MENU_MARGIN), maxLeft)
}

function areSuggestionListsEqual(
  left: MarkdownWikiLinkTarget[],
  right: MarkdownWikiLinkTarget[],
): boolean {
  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index]?.path !== right[index]?.path) {
      return false
    }
  }

  return true
}

function isSameMenuState(
  left: WikiLinkSuggestionMenuState | null,
  right: WikiLinkSuggestionMenuState | null,
): boolean {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return (
    left.query === right.query &&
    left.replaceFrom === right.replaceFrom &&
    left.replaceTo === right.replaceTo &&
    left.anchorLeft === right.anchorLeft &&
    left.anchorTop === right.anchorTop &&
    left.selectedIndex === right.selectedIndex &&
    areSuggestionListsEqual(left.suggestions, right.suggestions)
  )
}

function buildWikiLinkMenuState(
  context: WikiLinkMenuContext | null,
  currentState: WikiLinkSuggestionMenuState | null,
  targets: MarkdownWikiLinkTarget[],
): WikiLinkSuggestionMenuState | null {
  if (!context) {
    return null
  }

  const suggestions = searchWikiLinkTargets(targets, context.query)
  if (suggestions.length === 0) {
    return null
  }

  const previousSelectionPath =
    currentState && currentState.suggestions.length > 0
      ? currentState.suggestions[currentState.selectedIndex]?.path
      : undefined

  let selectedIndex = 0
  if (previousSelectionPath) {
    const index = suggestions.findIndex((target) => target.path === previousSelectionPath)
    if (index >= 0) {
      selectedIndex = index
    }
  }

  return {
    query: context.query,
    replaceFrom: context.replaceFrom,
    replaceTo: context.replaceTo,
    anchorLeft: clampWikiLinkMenuLeft(context.anchorLeft),
    anchorTop: Math.max(context.anchorTop, WIKI_LINK_MENU_MARGIN),
    suggestions,
    selectedIndex,
  }
}

function insertWikiLinkSuggestion(
  view: EditorView,
  menuState: WikiLinkSuggestionMenuState,
  target: MarkdownWikiLinkTarget,
): void {
  const replacement = `[[${target.wikiLink}]]`
  let transaction = view.state.tr.insertText(replacement, menuState.replaceFrom, menuState.replaceTo)
  const nextSelection = menuState.replaceFrom + replacement.length
  transaction = transaction.setSelection(TextSelection.create(transaction.doc, nextSelection))
  view.dispatch(transaction.scrollIntoView())
}

const MERMAID_KEYWORDS = [
  'erDiagram', 'flowchart', 'graph ', 'graph\t', 'graph\n',
  'sequenceDiagram', 'classDiagram', 'stateDiagram', 'stateDiagram-v2',
  'gantt', 'pie', 'gitGraph', 'mindmap', 'journey', 'requirementDiagram',
  'c4Context', 'c4Container', 'c4Component', 'c4Dynamic', 'c4Deployment',
  'timeline', 'sankey-beta', 'xychart-beta', 'block-beta', 'packet-beta',
  'kanban', 'architecture-beta',
]

function looksLikeMermaid(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false
  const firstLine = trimmed.split('\n')[0]?.trim().toLowerCase() || ''
  return MERMAID_KEYWORDS.some((kw) => firstLine.startsWith(kw.toLowerCase()))
}

function renderMermaidPreview(
  _language: string,
  content: string,
  blockIndex: number,
  applyPreview: (html: string) => void,
): void {
  // Use deterministic ids so repeated renderPreview calls for the same block
  // reuse the existing host instead of creating orphan placeholders.
  const uniqueId = `${quickHash(content)}_${blockIndex}`
  const containerId = `notia-mmd-host-${uniqueId}`
  const storageKey = `mmd-inline-${uniqueId}`

  // If the host is already in the DOM, Milkdown already rendered this block.
  // Skip re-injection to avoid flashing and orphan React roots.
  if (document.getElementById(containerId)) {
    return
  }

  // Render a placeholder with visible text and a minimum size so DOMPurify
  // (used by Milkdown) does not purge the container and the block never
  // collapses to 0 height while the diagram loads.
  const placeholder = `<div id="${containerId}" class="notia-mermaid-inline-host" data-code="${encodeURIComponent(content)}" data-storage-key="${storageKey}" style="min-height:160px;width:100%;" data-render-id="${uniqueId}"><div style="padding:12px;color:var(--color-icon-muted);font-size:13px;">Renderizando diagrama...</div></div>`
  applyPreview(placeholder)

  requestAnimationFrame(() => {
    const host = document.getElementById(containerId)
    if (!host || !host.isConnected) {
      // Milkdown may have replaced the placeholder before the frame ran.
      // This is expected during fast re-renders; do not spam warnings.
      return
    }
    mountInlineMermaidPreview(host, content, storageKey)
  })
}

function MarkdownViewInner({
  source,
  documentPath,
  onSourceChange,
  wikiLinkTargets,
  onOpenLinkedFile,
  zoom,
  onZoomChange,
}: MarkdownViewProps) {
  const parsedDocument = useMemo(() => parseFrontmatterDocument(source), [source])
  const wikiLinkLookup = useMemo(() => buildWikiLinkLookup(wikiLinkTargets), [wikiLinkTargets])

  const [wikiLinkMenuState, setWikiLinkMenuState] = useState<WikiLinkSuggestionMenuState | null>(null)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const zoomContentRef = useRef<HTMLDivElement | null>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const isReadyRef = useRef(false)
  const isApplyingExternalUpdateRef = useRef(false)
  const initialBodyRef = useRef(parsedDocument.body)
  const latestComposedSourceRef = useRef(source)
  const latestBodyRef = useRef(parsedDocument.body)
  const frontmatterRef = useRef(parsedDocument.frontmatter)
  const hasFrontmatterRef = useRef(parsedDocument.hasFrontmatter)
  const documentPathRef = useRef(documentPath)
  const onSourceChangeRef = useRef(onSourceChange)
  const wikiLinkTargetsRef = useRef(wikiLinkTargets)
  const wikiLinkLookupRef = useRef<MarkdownWikiLinkLookup>(wikiLinkLookup)
  const wikiLinkMenuStateRef = useRef<WikiLinkSuggestionMenuState | null>(null)
  const isWikiLinkMenuOpenRef = useRef(false)
  const onOpenLinkedFileRef = useRef(onOpenLinkedFile)
  const mermaidPreviewBlockIndexRef = useRef(0)

  useMarkdownZoom(viewportRef, zoomContentRef, zoom, onZoomChange)

  useEffect(() => {
    if (source === latestComposedSourceRef.current) {
      return
    }

    latestComposedSourceRef.current = source
    latestBodyRef.current = parsedDocument.body
    frontmatterRef.current = parsedDocument.frontmatter
    hasFrontmatterRef.current = parsedDocument.hasFrontmatter
    // If Crepe has not been created yet, make sure it will use the latest body
    // as its initial content. This handles the case where the first render has
    // an empty/stale source and the real content arrives before create().
    initialBodyRef.current = parsedDocument.body
  }, [parsedDocument, source])

  const appTheme = useAppSelector(selectTheme)
  const themeRef = useRef(appTheme)
  useEffect(() => {
    themeRef.current = appTheme
  }, [appTheme])

  useEffect(() => {
    onSourceChangeRef.current = onSourceChange
  }, [onSourceChange])

  useEffect(() => {
    wikiLinkTargetsRef.current = wikiLinkTargets
    wikiLinkLookupRef.current = wikiLinkLookup
  }, [wikiLinkLookup, wikiLinkTargets])

  useEffect(() => {
    documentPathRef.current = documentPath
  }, [documentPath])

  useEffect(() => {
    onOpenLinkedFileRef.current = onOpenLinkedFile
  }, [onOpenLinkedFile])

  useEffect(() => {
    wikiLinkMenuStateRef.current = wikiLinkMenuState
    isWikiLinkMenuOpenRef.current = Boolean(wikiLinkMenuState)
  }, [wikiLinkMenuState])

  useEffect(() => {
    if (!rootRef.current) {
      return
    }

    const crepe = new Crepe({
      root: rootRef.current,
      defaultValue: initialBodyRef.current,
      features: {
        [Crepe.Feature.Toolbar]: false,
        [Crepe.Feature.BlockEdit]: true,
      },
      featureConfigs: {
        [Crepe.Feature.BlockEdit]: {
          buildMenu: (builder) => {
            const advancedGroup = builder.getGroup('advanced')
            advancedGroup.addItem('mermaid', {
              label: 'Mermaid',
              icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
              onRun: (ctx) => {
                const commands = ctx.get(commandsCtx)
                const codeBlock = codeBlockSchema.type(ctx)
                commands.call(clearTextInCurrentBlockCommand.key)
                commands.call(setBlockTypeCommand.key, {
                  nodeType: codeBlock,
                  attrs: { language: 'mermaid' },
                })
              },
            })
          },
        },
      },
    })

    let isMounted = true
    const inlineHosts = new Set<HTMLElement>()

    const cleanupInlinePreviews = () => {
      rootRef.current?.querySelectorAll('.notia-mermaid-inline-host').forEach((node) => {
        const host = node as HTMLElement
        inlineHosts.add(host)
      })
      inlineHosts.forEach((host) => {
        unmountInlineMermaidPreview(host)
      })
      inlineHosts.clear()
    }

    const clearDocumentRefs = () => {
      latestComposedSourceRef.current = ''
      latestBodyRef.current = ''
      frontmatterRef.current = []
      hasFrontmatterRef.current = false
      initialBodyRef.current = ''
    }

    crepe.editor.config((ctx) => {
      ctx.update(codeBlockConfig.key, (prev) => ({
        ...prev,
        renderPreview: (language, content, applyPreview) => {
          const lowerLang = language.toLowerCase().trim()
          // Activar preview Mermaid en tres casos:
          // 1. Lenguaje explícitamente "mermaid"
          // 2. Lenguaje vacío (bloques sin especificar lenguaje)
          // 3. Lenguaje "text" pero contenido parece diagrama Mermaid
          const isMermaidLang = lowerLang === 'mermaid'
          const isEmptyLang = lowerLang === ''
          const isTextButMermaid = lowerLang === 'text' && looksLikeMermaid(content)
          if (isMermaidLang || isEmptyLang || isTextButMermaid) {
            const blockIndex = mermaidPreviewBlockIndexRef.current
            mermaidPreviewBlockIndexRef.current += 1
            renderMermaidPreview(lowerLang, content, blockIndex, applyPreview)
            return undefined
          }
          return prev.renderPreview(language, content, applyPreview)
        },
      }))
    })

    crepe.editor.use(
      createWikiLinkPlugin({
        getLookup: () => wikiLinkLookupRef.current,
        isMenuOpen: () => isWikiLinkMenuOpenRef.current,
        onMenuContextChange: (context) => {
          setWikiLinkMenuState((currentState) => {
            const nextState = buildWikiLinkMenuState(context, currentState, wikiLinkTargetsRef.current)
            return isSameMenuState(currentState, nextState) ? currentState : nextState
          })
        },
        onMoveMenuSelection: (direction) => {
          setWikiLinkMenuState((currentState) => {
            if (!currentState || currentState.suggestions.length === 0) {
              return currentState
            }

            const optionsCount = currentState.suggestions.length
            const nextIndex =
              direction === 1
                ? (currentState.selectedIndex + 1) % optionsCount
                : (currentState.selectedIndex - 1 + optionsCount) % optionsCount

            if (nextIndex === currentState.selectedIndex) {
              return currentState
            }

            return {
              ...currentState,
              selectedIndex: nextIndex,
            }
          })
        },
        onCloseMenu: () => {
          setWikiLinkMenuState((currentState) => (currentState ? null : currentState))
        },
        onConfirmMenuSelection: (view) => {
          const menuState = wikiLinkMenuStateRef.current
          if (!menuState || menuState.suggestions.length === 0) {
            return false
          }

          const target = menuState.suggestions[menuState.selectedIndex] ?? menuState.suggestions[0]
          if (!target) {
            return false
          }

          insertWikiLinkSuggestion(view, menuState, target)
          setWikiLinkMenuState(null)
          return true
        },
        onOpenLinkPath: (path) => {
          onOpenLinkedFileRef.current(path)
        },
      }),
    )

    crepe.editor.use(gfm)
    crepe.editor.use(emoji)
    crepe.editor.use(cursor)
    crepe.editor.use(indent)
    crepe.editor.use(trailing)
    crepe.editor.use(clipboard)

    crepeRef.current = crepe

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (!isMounted || isApplyingExternalUpdateRef.current) {
          return
        }

        if (markdown === latestBodyRef.current) {
          return
        }

        latestBodyRef.current = markdown

        const nextSource = serializeFrontmatterDocument({
          hasFrontmatter: hasFrontmatterRef.current,
          frontmatter: frontmatterRef.current,
          body: markdown,
        })

        if (nextSource === latestComposedSourceRef.current) {
          return
        }

        latestComposedSourceRef.current = nextSource
        onSourceChangeRef.current(nextSource)
      })
    })

    void crepe.create().then(() => {
      if (!isMounted) {
        return
      }

      isReadyRef.current = true
    })

    return () => {
      isMounted = false
      isReadyRef.current = false
      crepeRef.current = null
      setWikiLinkMenuState(null)
      cleanupInlinePreviews()
      clearDocumentRefs()
      void crepe.destroy()
    }
  }, [])

  useEffect(() => {
    if (!source) return
    mermaidPreviewBlockIndexRef.current = 0
  }, [source])


  useEffect(() => {
    const crepe = crepeRef.current
    if (!crepe || !isReadyRef.current) {
      return
    }

    // When props are behind local typing, do not push stale content into the editor.
    if (source !== latestComposedSourceRef.current) {
      return
    }

    // If our tracked body already matches the incoming body, this is not an external body change.
    if (parsedDocument.body === latestBodyRef.current) {
      return
    }

    const currentMarkdown = crepe.getMarkdown()
    if (currentMarkdown === parsedDocument.body) {
      latestBodyRef.current = currentMarkdown
      return
    }

    isApplyingExternalUpdateRef.current = true
    crepe.editor.action(replaceAll(parsedDocument.body, true))
    isApplyingExternalUpdateRef.current = false
    latestBodyRef.current = parsedDocument.body
  }, [parsedDocument.body, source])

  useEffect(() => {
    const crepe = crepeRef.current
    if (!crepe || !isReadyRef.current) {
      return
    }

    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const refreshTransaction = view.state.tr.setMeta('notia-refresh-wikilinks', Date.now())
      view.dispatch(refreshTransaction)
    })
  }, [wikiLinkLookup])

  const handleAddProperty = (entry: FrontmatterEntry) => {
    const nextEntries = [...frontmatterRef.current, entry]
    frontmatterRef.current = nextEntries
    hasFrontmatterRef.current = true

    const nextSource = serializeFrontmatterDocument({
      hasFrontmatter: true,
      frontmatter: nextEntries,
      body: latestBodyRef.current,
    })

    latestComposedSourceRef.current = nextSource
    onSourceChangeRef.current(nextSource)
  }

  const handleEditProperty = async (key: string, value: unknown) => {
    const index = frontmatterRef.current.findIndex((entry) => entry.key === key)
    if (index < 0) return

    // Capture the old value BEFORE mutating.
    const oldValue = frontmatterRef.current[index]?.value

    const nextEntries = [...frontmatterRef.current]
    nextEntries[index] = { key, value: value as FrontmatterEntry['value'] }
    frontmatterRef.current = nextEntries

    const nextSource = serializeFrontmatterDocument({
      hasFrontmatter: true,
      frontmatter: nextEntries,
      body: latestBodyRef.current,
    })

    latestComposedSourceRef.current = nextSource
    onSourceChangeRef.current(nextSource)

    // Bidirectional sync for page links using the pageLinkSyncEngine
    const lowerKey = key.toLowerCase()
    if (lowerKey === 'nextpage' || lowerKey === 'previouspage') {
      const linkKey = lowerKey === 'nextpage' ? 'nextPage' : 'previousPage'

      const readSource = async (path: string): Promise<string | null> => {
        try {
          const result = await readLibraryFileContent(path)
          return result.ok ? result.content : null
        } catch {
          return null
        }
      }

      const writeSource = async (path: string, source: string): Promise<void> => {
        try {
          const result = await writeLibraryFileContent(path, source)
          if (!result.ok) {
            import('../../../services/runtime/notiaLogger').then(({ notiaLog }) => {
              notiaLog('markdown', 'writeSource failed', { path, error: result.error }, 'error')
            })
          }
        } catch (error) {
          import('../../../services/runtime/notiaLogger').then(({ notiaLog }) => {
            notiaLog('markdown', 'writeSource error', { path, error: String(error) }, 'error')
          })
        }
      }

      const result = await syncPageLink(
        documentPath,
        nextSource,
        linkKey,
        oldValue,
        value,
        readSource,
        writeSource,
      )

      if (result.mutated) {
        // If the engine further mutated the source (e.g. to canonicalize the value),
        // update our local state.
        const finalDocument = parseFrontmatterDocument(result.currentSource)
        frontmatterRef.current = finalDocument.frontmatter
        latestComposedSourceRef.current = result.currentSource
        onSourceChangeRef.current(result.currentSource)
      }

      if (result.error) {
        console.error('[MarkdownView] Page link sync error:', result.error)
      }
    }
  }

  const handleDeleteProperty = (key: string) => {
    const nextEntries = frontmatterRef.current.filter((entry) => entry.key !== key)
    frontmatterRef.current = nextEntries
    if (nextEntries.length === 0) {
      hasFrontmatterRef.current = false
    }

    const nextSource = serializeFrontmatterDocument({
      hasFrontmatter: hasFrontmatterRef.current,
      frontmatter: nextEntries,
      body: latestBodyRef.current,
    })

    latestComposedSourceRef.current = nextSource
    onSourceChangeRef.current(nextSource)
  }

  const handleWikiLinkSelect = (index: number) => {
    const menuState = wikiLinkMenuStateRef.current
    const crepe = crepeRef.current
    if (!menuState || !crepe || !isReadyRef.current) {
      return
    }

    const target = menuState.suggestions[index]
    if (!target) {
      return
    }

    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
    insertWikiLinkSuggestion(view, menuState, target)
    setWikiLinkMenuState(null)
  }

  return (
    <div ref={viewportRef} className="notia-markdown-host" aria-label="Markdown editor">
      <div ref={zoomContentRef} className="notia-markdown-zoom-content">
        <div className="notia-markdown-properties-wrap">
          <MarkdownPropertiesPanel
            entries={parsedDocument.frontmatter}
            wikiLinkLookup={wikiLinkLookup}
            wikiLinkTargets={wikiLinkTargets}
            onAddProperty={handleAddProperty}
            onEditProperty={handleEditProperty}
            onDeleteProperty={handleDeleteProperty}
            onOpenLinkedFile={onOpenLinkedFile}
          />
        </div>
        <div ref={rootRef} className="notia-markdown-editor-root" />
      </div>
      <WikiLinkSuggestionMenu state={wikiLinkMenuState} onSelect={handleWikiLinkSelect} />
    </div>
  )
}

export const MarkdownView = memo(MarkdownViewInner)
MarkdownView.displayName = 'MarkdownView'
