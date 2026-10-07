import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getMeetingContextOptions, saveMeetingContextChoice } from '../../../../services/meeting/meetingService'
import type { MeetingAiContext, MeetingContextChoice, MeetingContextOptions } from '../../../../services/meeting/meetingTypes'

/** What the person chose in «Contexto para la IA» before recording. */
export type MeetingAiContextChoice = MeetingContextChoice

export interface MeetingAiContextState {
  libraryName: string | null
  options: MeetingContextOptions | null
  error: string | null
  /** The last change could not be kept for the next recording. */
  saveError: string | null
  choice: MeetingAiContextChoice
  setWholeLibrary: (wholeLibrary: boolean) => void
  /** A folder of the library; `null` is «Ninguna». */
  setFolder: (folder: string | null) => void
  toggleContext: (tag: string) => void
  setAllContexts: (selected: boolean) => void
}

const EMPTY_CHOICE: MeetingAiContextChoice = { wholeLibrary: true, folder: null, contexts: [] }

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/**
 * The folders and contexts of the open library and the person's choice. The
 * backend lists them, keeps the choice of each library between recordings
 * and decides which notes it admits; this shows it and sends each change.
 */
export function useMeetingAiContext(library: { id: string; name: string } | null) {
  const libraryId = library?.id ?? null
  const [options, setOptions] = useState<MeetingContextOptions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [choice, setChoice] = useState<MeetingAiContextChoice>(EMPTY_CHOICE)
  const choiceRef = useRef(choice)
  choiceRef.current = choice

  useEffect(() => {
    let current = true
    setOptions(null)
    setError(null)
    setSaveError(null)
    setChoice(EMPTY_CHOICE)
    if (!libraryId) return
    void getMeetingContextOptions(libraryId).then((loaded) => {
      if (!current) return
      setOptions(loaded)
      setChoice(loaded.choice)
    }).catch((reason: unknown) => {
      if (current) setError(errorText(reason, 'No se pudieron leer las carpetas y los contextos.'))
    })
    return () => { current = false }
  }, [libraryId])

  const change = useCallback((next: (current: MeetingAiContextChoice) => MeetingAiContextChoice) => {
    if (!libraryId) return
    const updated = next(choiceRef.current)
    choiceRef.current = updated
    setChoice(updated)
    void saveMeetingContextChoice(libraryId, updated).then(
      () => setSaveError(null),
      (reason: unknown) => setSaveError(errorText(reason, 'No se pudo guardar el contexto para la IA.')),
    )
  }, [libraryId])

  const setWholeLibrary = useCallback((wholeLibrary: boolean) => {
    change((current) => ({ ...current, wholeLibrary }))
  }, [change])
  const setFolder = useCallback((folder: string | null) => {
    change((current) => ({ ...current, folder }))
  }, [change])
  const toggleContext = useCallback((tag: string) => {
    change((current) => ({
      ...current,
      contexts: current.contexts.includes(tag) ? current.contexts.filter((known) => known !== tag) : [...current.contexts, tag],
    }))
  }, [change])
  const setAllContexts = useCallback((selected: boolean) => {
    change((current) => ({ ...current, contexts: selected ? (options?.contexts.map((context) => context.tag) ?? []) : [] }))
  }, [change, options])

  // Without the options the backend could not list, or with «Ninguna», the AI reads nothing of the library.
  const aiContext = useMemo<MeetingAiContext | null>(() => {
    if (!libraryId || !options) return null
    if (!choice.wholeLibrary) return choice.folder ? { libraryId, folder: choice.folder, contexts: null } : null
    return { libraryId, folder: null, contexts: choice.contexts }
  }, [choice, libraryId, options])

  const state: MeetingAiContextState = {
    libraryName: library?.name ?? null,
    options,
    error,
    saveError,
    choice,
    setWholeLibrary,
    setFolder,
    toggleContext,
    setAllContexts,
  }
  return { state, aiContext }
}

/** `Facultad`, `Ninguna carpeta`, `Toda la librería · 2 de 3`, for the summaries of the choice. */
export function describeAiContext({ options, error, choice, libraryName }: MeetingAiContextState): string {
  if (!libraryName) return 'Abrí una biblioteca'
  if (!options) return error ? 'No disponible' : 'Cargando…'
  if (!choice.wholeLibrary) return choice.folder ?? 'Ninguna carpeta'
  return `Toda la librería · ${choice.contexts.length} de ${options.contexts.length}`
}
