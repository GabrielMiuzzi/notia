import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { TaskBoardIntent } from '../../services/taskManagerService'
import type { TaskItem } from '../../types/taskManagerTypes'
import { LEAVE_MS, prefersReducedMotion } from './taskDisplay'
import type { LeaveKind, MenuState, MenuView, PopKind, TaskBoardActions } from './taskViewTypes'

/*
 * Ephemeral interface state of the board and the list: which popover or menu
 * is open, which card is being renamed or shows its subtasks, which card is
 * leaving. Every change of data goes to Rust through `onIntent`.
 */

const LEAVE_INTENT: Record<LeaveKind, 'finish-task' | 'cancel-task' | 'delete-task'> = {
  finish: 'finish-task',
  cancel: 'cancel-task',
  delete: 'delete-task',
}

/** How long the view keeps a card in place after its action: the reload arrives later. */
const ANCHOR_HOLD_MS = 1500

export interface TaskCardActions {
  /** Sends an intent; true when the backend accepted it (the shell shows errors). */
  send: (intent: TaskBoardIntent, anchorPath?: string) => Promise<boolean>
  /** Finish, cancel or delete: the card leaves first, then the intent goes; it comes back on error. */
  leave: (task: TaskItem, kind: LeaveKind) => void
  openPop: (task: TaskItem, kind: PopKind) => void
  togglePop: (task: TaskItem, kind: PopKind) => void
  closePop: () => void
  toggleMenu: (task: TaskItem, view: 'menu' | 'prio', trigger: HTMLElement, align: 'start' | 'end') => void
  showMenuView: (view: MenuView) => void
  closeMenu: (restoreFocus: boolean) => void
  startRename: (task: TaskItem) => void
  cancelRename: () => void
  rename: (task: TaskItem, title: string) => void
  toggleExpanded: (task: TaskItem) => void
  moveTo: (task: TaskItem, groupName: string) => void
  flashTask: (path: string) => void
  openTask: (task: TaskItem) => void
  editSource: (task: TaskItem) => void
  comment: (task: TaskItem) => void
  openPeoplePanel: (tab: 'people' | 'projects') => void
}

export interface TaskUiState {
  pop: { path: string; kind: PopKind } | null
  menu: MenuState | null
  renaming: string | null
  expanded: ReadonlySet<string>
  leaving: ReadonlySet<string>
  flash: { path: string; seq: number } | null
  /** Titles sent with «Renombrar», shown until the backend answers. */
  titles: ReadonlyMap<string, string>
}

export interface TaskInteractionOptions extends TaskBoardActions {
  /** The view root: cards carry `data-task-path`. */
  rootRef: RefObject<HTMLElement | null>
  /** Changes when the backend sends a new board. */
  snapshot: unknown
  /** A task was moved to this column; the view opens it. */
  onMovedTo: (groupName: string) => void
}

/** A click this soon after a drag belongs to the drag. */
const CLICK_AFTER_DRAG_MS = 400

export const TaskActionsContext = createContext<TaskCardActions | null>(null)

export function useTaskActions(): TaskCardActions {
  const actions = useContext(TaskActionsContext)
  if (!actions) throw new Error('useTaskActions needs a TaskActionsContext provider.')
  return actions
}

function withItem(set: ReadonlySet<string>, item: string): Set<string> {
  const next = new Set(set)
  next.add(item)
  return next
}

function withoutItem(set: ReadonlySet<string>, item: string): Set<string> {
  const next = new Set(set)
  next.delete(item)
  return next
}

function scrollParent(element: HTMLElement | null): HTMLElement {
  let current = element?.parentElement ?? null
  while (current) {
    const overflow = window.getComputedStyle(current).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && current.scrollHeight > current.clientHeight) return current
    current = current.parentElement
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

function findCard(root: HTMLElement | null, path: string): HTMLElement | null {
  if (!root || !path) return null
  return root.querySelector<HTMLElement>(`[data-task-path="${CSS.escape(path)}"]`)
}

export interface TaskInteractions {
  ui: TaskUiState
  actions: TaskCardActions
  /** A drag just ended: the click that follows must not open the ticket. */
  noteDragEnd: () => void
}

export function useTaskInteractions(options: TaskInteractionOptions): TaskInteractions {
  const optionsRef = useRef(options)
  useLayoutEffect(() => {
    optionsRef.current = options
  })

  const [pop, setPop] = useState<TaskUiState['pop']>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set())
  const [flash, setFlash] = useState<TaskUiState['flash']>(null)
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(() => new Map())
  const menuRef = useRef<MenuState | null>(null)
  const anchorRef = useRef<{ path: string; top: number; scrollTop: number } | null>(null)
  const anchorTimerRef = useRef<number | null>(null)
  const dragEndRef = useRef(0)

  useEffect(() => {
    menuRef.current = menu
  }, [menu])

  // Keeps the card of the last action where it was on the screen when the
  // board reloads and lists above it grow or shrink.
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const root = optionsRef.current.rootRef.current
    const container = scrollParent(root)
    const card = findCard(root, anchor.path)
    if (card) container.scrollTop += card.getBoundingClientRect().top - anchor.top
  }, [options.snapshot])

  useEffect(() => () => {
    if (anchorTimerRef.current !== null) window.clearTimeout(anchorTimerRef.current)
  }, [])

  const holdCard = useCallback((path: string) => {
    const root = optionsRef.current.rootRef.current
    const card = findCard(root, path)
    if (!card) return
    anchorRef.current = { path, top: card.getBoundingClientRect().top, scrollTop: scrollParent(root).scrollTop }
    if (anchorTimerRef.current !== null) window.clearTimeout(anchorTimerRef.current)
    anchorTimerRef.current = window.setTimeout(() => {
      anchorRef.current = null
      anchorTimerRef.current = null
    }, ANCHOR_HOLD_MS)
  }, [])

  const send = useCallback(async (intent: TaskBoardIntent, anchorPath?: string) => {
    if (anchorPath) holdCard(anchorPath)
    try {
      await optionsRef.current.onIntent(intent)
      return true
    } catch {
      return false
    }
  }, [holdCard])

  const flashTask = useCallback((path: string) => {
    setFlash((current) => ({ path, seq: (current?.seq ?? 0) + 1 }))
  }, [])

  const closeMenu = useCallback((restoreFocus: boolean) => {
    const current = menuRef.current
    menuRef.current = null
    setMenu(null)
    if (restoreFocus && current?.trigger?.isConnected) current.trigger.focus()
  }, [])

  const leave = useCallback((task: TaskItem, kind: LeaveKind) => {
    const path = task.filePath
    menuRef.current = null
    setMenu(null)
    setPop(null)
    setLeaving((current) => withItem(current, path))
    window.setTimeout(() => {
      optionsRef.current.onIntent({ kind: LEAVE_INTENT[kind], taskPath: path })
        .catch(() => setLeaving((current) => withoutItem(current, path)))
    }, prefersReducedMotion() ? 0 : LEAVE_MS)
  }, [])

  const openPop = useCallback((task: TaskItem, kind: PopKind) => {
    menuRef.current = null
    setMenu(null)
    setPop({ path: task.filePath, kind })
  }, [])

  const togglePop = useCallback((task: TaskItem, kind: PopKind) => {
    menuRef.current = null
    setMenu(null)
    setPop((current) => (current?.path === task.filePath && current.kind === kind ? null : { path: task.filePath, kind }))
  }, [])

  const closePop = useCallback(() => setPop(null), [])

  const toggleMenu = useCallback((task: TaskItem, view: 'menu' | 'prio', trigger: HTMLElement, align: 'start' | 'end') => {
    const current = menuRef.current
    if (current?.path === task.filePath && current.trigger === trigger) {
      closeMenu(false)
      return
    }
    const rect = trigger.getBoundingClientRect()
    const next: MenuState = {
      path: task.filePath,
      view,
      anchor: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
      align,
      trigger,
    }
    menuRef.current = next
    setPop(null)
    setMenu(next)
  }, [closeMenu])

  const showMenuView = useCallback((view: MenuView) => {
    setMenu((current) => {
      const next = current ? { ...current, view } : null
      menuRef.current = next
      return next
    })
  }, [])

  const startRename = useCallback((task: TaskItem) => {
    menuRef.current = null
    setMenu(null)
    setPop(null)
    setRenaming(task.filePath)
  }, [])

  const cancelRename = useCallback(() => setRenaming(null), [])

  const rename = useCallback((task: TaskItem, raw: string) => {
    setRenaming(null)
    const title = raw.trim()
    if (!title || title === task.title) return
    const path = task.filePath
    setTitles((current) => new Map(current).set(path, title))
    void send({ kind: 'rename-task', taskPath: path, title }, path).then((ok) => {
      setTitles((current) => {
        const next = new Map(current)
        next.delete(path)
        return next
      })
      if (ok) flashTask(path)
    })
  }, [flashTask, send])

  const toggleExpanded = useCallback((task: TaskItem) => {
    setExpanded((current) => (current.has(task.filePath) ? withoutItem(current, task.filePath) : withItem(current, task.filePath)))
  }, [])

  const moveTo = useCallback((task: TaskItem, groupName: string) => {
    if (task.group === groupName) return
    void send({ kind: 'move-task', taskPath: task.filePath, group: groupName }).then((ok) => {
      if (!ok) return
      optionsRef.current.onMovedTo(groupName)
      flashTask(task.filePath)
    })
  }, [flashTask, send])

  const noteDragEnd = useCallback(() => {
    dragEndRef.current = Date.now()
  }, [])

  const openTask = useCallback((task: TaskItem) => {
    if (Date.now() - dragEndRef.current < CLICK_AFTER_DRAG_MS) return
    optionsRef.current.onOpenTask(task)
  }, [])
  const editSource = useCallback((task: TaskItem) => optionsRef.current.onEditSource(task), [])
  const comment = useCallback((task: TaskItem) => optionsRef.current.onComment(task), [])
  const openPeoplePanel = useCallback((tab: 'people' | 'projects') => {
    setPop(null)
    optionsRef.current.onOpenPeoplePanel(tab)
  }, [])

  const actions = useMemo<TaskCardActions>(() => ({
    send,
    leave,
    openPop,
    togglePop,
    closePop,
    toggleMenu,
    showMenuView,
    closeMenu,
    startRename,
    cancelRename,
    rename,
    toggleExpanded,
    moveTo,
    flashTask,
    openTask,
    editSource,
    comment,
    openPeoplePanel,
  }), [cancelRename, closeMenu, closePop, comment, editSource, flashTask, leave, moveTo, openPeoplePanel, openPop, openTask, rename, send, showMenuView, startRename, toggleExpanded, toggleMenu, togglePop])

  const ui = useMemo<TaskUiState>(
    () => ({ pop, menu, renaming, expanded, leaving, flash, titles }),
    [expanded, flash, leaving, menu, pop, renaming, titles],
  )

  return { ui, actions, noteDragEnd }
}
