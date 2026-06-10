import { memo, useEffect, useMemo, useRef, useState } from 'react'
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

import {
  mountInlineMermaidPreview,
  unmountInlineMermaidPreview,
} from '../../../modules/mermaid/services/mermaidPreviewRuntime'

function renderMermaidPreview(
  content: string,
  applyPreview: (html: string) => void,
): void {
  const id = `notia-mmd-${Math.random().toString(36).slice(2)}`
  const containerId = `notia-mmd-host-${id}`
  const div = document.createElement('div')
  div.id = containerId
  div.className = 'notia-mermaid-inline-host'
  div.dataset.code = content
  applyPreview(div.outerHTML)

  // Mount the React component after the DOM node exists in Milkdown's output
  requestAnimationFrame(() => {
    const host = document.getElementById(containerId)
    if (host) {
      mountInlineMermaidPreview(host, content)
    }
  })
}

function MarkdownViewInner({
  source,
  documentPath,
  onSourceChange,
  wikiLinkTargets,
  onOpenLinkedFile,
}: MarkdownViewProps) {
  const parsedDocument = useMemo(() => parseFrontmatterDocument(source), [source])
  const wikiLinkLookup = useMemo(() => buildWikiLinkLookup(wikiLinkTargets), [wikiLinkTargets])

  const [wikiLinkMenuState, setWikiLinkMenuState] = useState<WikiLinkSuggestionMenuState | null>(null)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const isReadyRef = useRef(false)
  const isApplyingExternalUpdateRef = useRef(false)
  const initialBodyRef = useRef(parsedDocument.body)
  const latestComposedSourceRef = useRef(source)
  const latestBodyRef = useRef(parsedDocument.body)
  const frontmatterRef = useRef(parsedDocument.frontmatter)
  const hasFrontmatterRef = useRef(parsedDocument.hasFrontmatter)
  const onSourceChangeRef = useRef(onSourceChange)
  const wikiLinkTargetsRef = useRef(wikiLinkTargets)
  const wikiLinkLookupRef = useRef<MarkdownWikiLinkLookup>(wikiLinkLookup)
  const wikiLinkMenuStateRef = useRef<WikiLinkSuggestionMenuState | null>(null)
  const isWikiLinkMenuOpenRef = useRef(false)
  const onOpenLinkedFileRef = useRef(onOpenLinkedFile)

  useEffect(() => {
    if (source === latestComposedSourceRef.current) {
      return
    }

    latestComposedSourceRef.current = source
    latestBodyRef.current = parsedDocument.body
    frontmatterRef.current = parsedDocument.frontmatter
    hasFrontmatterRef.current = parsedDocument.hasFrontmatter
  }, [parsedDocument, source])

  useEffect(() => {
    onSourceChangeRef.current = onSourceChange
  }, [onSourceChange])

  useEffect(() => {
    wikiLinkTargetsRef.current = wikiLinkTargets
    wikiLinkLookupRef.current = wikiLinkLookup
  }, [wikiLinkLookup, wikiLinkTargets])

  useEffect(() => {
    onOpenLinkedFileRef.current = onOpenLinkedFile
  }, [onOpenLinkedFile])

  useEffect(() => {
    wikiLinkMenuStateRef.current = wikiLinkMenuState
    isWikiLinkMenuOpenRef.current = Boolean(wikiLinkMenuState)
  }, [wikiLinkMenuState])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.removedNodes)) {
          if (node instanceof HTMLElement) {
            node.querySelectorAll('.notia-mermaid-inline-host').forEach((el) => {
              unmountInlineMermaidPreview(el as HTMLElement)
            })
          }
        }
      }
    })

    observer.observe(root, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      root.querySelectorAll('.notia-mermaid-inline-host').forEach((el) => {
        unmountInlineMermaidPreview(el as HTMLElement)
      })
    }
  }, [])

  useEffect(() => {
    if (!rootRef.current) {
      return
    }

    let isMounted = true
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

    crepe.editor.config((ctx) => {
      ctx.update(codeBlockConfig.key, (prev) => ({
        ...prev,
        renderPreview: (language, content, applyPreview) => {
          if (language.toLowerCase() === 'mermaid') {
            void renderMermaidPreview(content, applyPreview)
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
      void crepe.destroy()
    }
  }, [])

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
    <div className="notia-markdown-host" aria-label="Markdown editor">
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
      <WikiLinkSuggestionMenu state={wikiLinkMenuState} onSelect={handleWikiLinkSelect} />
    </div>
  )
}

export const MarkdownView = memo(MarkdownViewInner)
MarkdownView.displayName = 'MarkdownView'
