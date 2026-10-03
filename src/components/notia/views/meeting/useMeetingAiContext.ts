import { useCallback, useEffect, useMemo, useState } from 'react'
import { getMeetingContextOptions } from '../../../../services/meeting/meetingService'
import type { MeetingAiContext, MeetingContextOptions } from '../../../../services/meeting/meetingTypes'

/** What the person chose in «Contexto para la IA» before recording. */
export interface MeetingAiContextChoice {
  wholeLibrary: boolean
  /** The chosen folder; used when `wholeLibrary` is off. */
  folder: string | null
  /** The allowed contexts; used with the whole library. */
  contexts: string[]
}

export interface MeetingAiContextState {
  libraryName: string | null
  options: MeetingContextOptions | null
  error: string | null
  choice: MeetingAiContextChoice
  setWholeLibrary: (wholeLibrary: boolean) => void
  setFolder: (folder: string) => void
  toggleContext: (tag: string) => void
  setAllContexts: (selected: boolean) => void
}

const EMPTY_CHOICE: MeetingAiContextChoice = { wholeLibrary: true, folder: null, contexts: [] }

/**
 * The folders and contexts of the open library and the person's choice. The
 * backend lists them and decides which notes the choice admits; this keeps
 * the choice until the recording starts.
 */
export function useMeetingAiContext(library: { id: string; name: string } | null) {
  const libraryId = library?.id ?? null
  const [options, setOptions] = useState<MeetingContextOptions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [choice, setChoice] = useState<MeetingAiContextChoice>(EMPTY_CHOICE)

  useEffect(() => {
    let current = true
    setOptions(null)
    setError(null)
    setChoice(EMPTY_CHOICE)
    if (!libraryId) return
    void getMeetingContextOptions(libraryId).then((loaded) => {
      if (!current) return
      setOptions(loaded)
      setChoice({
        wholeLibrary: true,
        folder: loaded.folders[0]?.path ?? null,
        contexts: loaded.contexts.filter((context) => context.selectedByDefault).map((context) => context.tag),
      })
    }).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : 'No se pudieron leer las carpetas y los contextos.')
    })
    return () => { current = false }
  }, [libraryId])

  const setWholeLibrary = useCallback((wholeLibrary: boolean) => {
    setChoice((current) => ({ ...current, wholeLibrary }))
  }, [])
  const setFolder = useCallback((folder: string) => {
    setChoice((current) => ({ ...current, folder }))
  }, [])
  const toggleContext = useCallback((tag: string) => {
    setChoice((current) => ({
      ...current,
      contexts: current.contexts.includes(tag) ? current.contexts.filter((known) => known !== tag) : [...current.contexts, tag],
    }))
  }, [])
  const setAllContexts = useCallback((selected: boolean) => {
    setChoice((current) => ({ ...current, contexts: selected ? (options?.contexts.map((context) => context.tag) ?? []) : [] }))
  }, [options])

  // Without the options the backend could not list, the AI reads nothing of the library.
  const aiContext = useMemo<MeetingAiContext | null>(() => {
    if (!libraryId || !options) return null
    if (!choice.wholeLibrary && choice.folder) return { libraryId, folder: choice.folder, contexts: null }
    return { libraryId, folder: null, contexts: choice.contexts }
  }, [choice, libraryId, options])

  const state: MeetingAiContextState = {
    libraryName: library?.name ?? null,
    options,
    error,
    choice,
    setWholeLibrary,
    setFolder,
    toggleContext,
    setAllContexts,
  }
  return { state, aiContext }
}

/** `Facultad · 24 notas`, `Toda la librería · 2 de 3`, for the summaries of the choice. */
export function describeAiContext({ options, error, choice, libraryName }: MeetingAiContextState): string {
  if (!libraryName) return 'Abrí una biblioteca'
  if (!options) return error ? 'No disponible' : 'Cargando…'
  if (!choice.wholeLibrary && choice.folder) return choice.folder
  return `Toda la librería · ${choice.contexts.length} de ${options.contexts.length}`
}
