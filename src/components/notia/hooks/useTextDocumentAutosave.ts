import { useCallback, useEffect, useRef } from 'react'
import { useAppSelector } from '../../../store/hooks'
import { selectOpenTabs } from '../../../features/documents/documentsSelectors'
import { isTextFileDocument, type OpenTextFileDocument } from '../../../types/views/fileDocument'
import type { OpenDocumentTab } from '../../../features/documents/documentsTypes'

const MARKDOWN_AUTOSAVE_DEBOUNCE_MS = 1200
const TEXT_AUTOSAVE_DEBOUNCE_MS = 380

interface PendingTextSaveJob {
  source: string
  timeoutId: number
}

type OpenTextDocumentTab = OpenDocumentTab & { document: OpenTextFileDocument }

function isOpenTextDocumentTab(tab: OpenDocumentTab): tab is OpenTextDocumentTab {
  return isTextFileDocument(tab.document)
}

function resolveTextAutosaveDebounceMs(document: OpenTextFileDocument): number {
  return document.viewKind === 'markdown'
    ? MARKDOWN_AUTOSAVE_DEBOUNCE_MS
    : TEXT_AUTOSAVE_DEBOUNCE_MS
}

export interface UseTextDocumentAutosaveActions {
  persistTextDocumentSource: (targetPath: string, targetSource: string) => Promise<boolean>
}

interface UseTextDocumentAutosaveReturn {
  clearPendingTextSaveByPath: (path: string) => void
  clearAllPendingTextSaves: () => void
}

export function useTextDocumentAutosave(
  actions: UseTextDocumentAutosaveActions,
): UseTextDocumentAutosaveReturn {
  const openTabs = useAppSelector(selectOpenTabs)
  const pendingTextSaveByPathRef = useRef<Map<string, PendingTextSaveJob>>(new Map())

  const clearPendingTextSaveByPath = useCallback((path: string) => {
    const pendingSave = pendingTextSaveByPathRef.current.get(path)
    if (!pendingSave) {
      return
    }

    window.clearTimeout(pendingSave.timeoutId)
    pendingTextSaveByPathRef.current.delete(path)
  }, [])

  const clearAllPendingTextSaves = useCallback(() => {
    for (const pendingSave of pendingTextSaveByPathRef.current.values()) {
      window.clearTimeout(pendingSave.timeoutId)
    }
    pendingTextSaveByPathRef.current.clear()
  }, [])

  // Autosave effect
  useEffect(() => {
    const dirtySourceByPath = new Map<string, string>()

    for (const tab of openTabs) {
      if (!isOpenTextDocumentTab(tab)) {
        continue
      }

      if (tab.saveStatus === 'error') {
        continue
      }

      if (tab.document.source === tab.latestSavedSource) {
        continue
      }

      dirtySourceByPath.set(tab.document.path, tab.document.source)
    }

    for (const [path, pendingSave] of pendingTextSaveByPathRef.current) {
      const dirtySource = dirtySourceByPath.get(path)
      if (dirtySource && dirtySource === pendingSave.source) {
        continue
      }

      window.clearTimeout(pendingSave.timeoutId)
      pendingTextSaveByPathRef.current.delete(path)
    }

    for (const tab of openTabs) {
      if (!isOpenTextDocumentTab(tab)) {
        continue
      }

      if (tab.saveStatus === 'error') {
        continue
      }

      if (tab.document.source === tab.latestSavedSource) {
        continue
      }

      const targetPath = tab.document.path
      const targetSource = tab.document.source
      const pendingSave = pendingTextSaveByPathRef.current.get(targetPath)
      if (pendingSave && pendingSave.source === targetSource) {
        continue
      }

      if (pendingSave) {
        window.clearTimeout(pendingSave.timeoutId)
      }

      const timeoutId = window.setTimeout(() => {
        const queuedSave = pendingTextSaveByPathRef.current.get(targetPath)
        if (!queuedSave || queuedSave.source !== targetSource) {
          return
        }

        pendingTextSaveByPathRef.current.delete(targetPath)
        void actions.persistTextDocumentSource(targetPath, targetSource)
      }, resolveTextAutosaveDebounceMs(tab.document))

      pendingTextSaveByPathRef.current.set(targetPath, {
        source: targetSource,
        timeoutId,
      })
    }
  }, [openTabs, actions.persistTextDocumentSource])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearAllPendingTextSaves()
    }
  }, [clearAllPendingTextSaves])

  return { clearPendingTextSaveByPath, clearAllPendingTextSaves }
}