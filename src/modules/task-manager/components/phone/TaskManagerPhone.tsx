import { useMemo, useState, type ReactNode } from 'react'
import type { TaskManagerBackendContext } from '../../services/taskManagerService'
import type { TaskBoardViewMode } from '../../services/taskManagerStorage'
import type { TaskArchive } from '../../types/taskBoardTypes'
import type { Board, Group, TaskItem } from '../../types/taskManagerTypes'
import type { ManagementRequest, ManagementView } from '../../types/managementTypes'
import { buildBoardModel } from '../card/taskDisplay'
import type { MoveTarget, TaskBoardActions } from '../card/taskViewTypes'
import { PhoneArchive } from './PhoneArchive'
import { PhoneBoard } from './PhoneBoard'
import { PhoneBoardsSheet } from './PhoneBoardsSheet'
import { PhoneBottomNav, type PhoneSection } from './PhoneBottomNav'
import { PhoneHeader } from './PhoneHeader'
import { PhoneList } from './PhoneList'
import { PhoneManagement } from './PhoneManagement'
import { PhoneTaskDetail } from './PhoneTaskDetail'
import '../../styles/taskPhone.css'

export interface TaskManagerPhoneProps extends TaskBoardActions {
  boards: Board[]
  board: Board
  groups: Group[]
  /** Open tasks of the board after the search. */
  tasks: TaskItem[]
  /** Open tasks of the board without the search. */
  allTasks: TaskItem[]
  query: string
  onQueryChange: (query: string) => void
  resultCount: number | null
  viewMode: TaskBoardViewMode
  onViewModeChange: (mode: TaskBoardViewMode) => void
  flashTaskId: string | null
  archive: TaskArchive
  finishedCount: number
  pomodoroRunning: boolean
  /** The Pomodoro panel of the app, shown in its section. */
  pomodoro: ReactNode
  management: { view: ManagementView | null; loading: boolean; error: string | null }
  managementRequest: ManagementRequest
  onManagementRequestChange: (request: ManagementRequest) => void
  context: TaskManagerBackendContext | null
  generation: number
  canManageBoards: boolean
  onSelectBoard: (name: string) => void
  onEditBoard: () => void
  onNewBoard: () => void
  onCreateTask: (groupName?: string) => void
  onUndo: () => void
  onRestore: (taskPath: string) => void
  onDeleteArchived: (taskPath: string) => void
}

/**
 * The Task Manager on a phone (canvas «Versión mobile»): sections at the
 * bottom, one screen at a time and sheets instead of menus. Every change
 * goes through the same intents as the desktop board.
 */
export function TaskManagerPhone(props: TaskManagerPhoneProps) {
  const {
    boards,
    board,
    groups,
    tasks,
    allTasks,
    query,
    onQueryChange,
    resultCount,
    viewMode,
    onViewModeChange,
    flashTaskId,
    archive,
    finishedCount,
    pomodoroRunning,
    pomodoro,
    management,
    managementRequest,
    onManagementRequestChange,
    context,
    generation,
    canManageBoards,
    onSelectBoard,
    onEditBoard,
    onNewBoard,
    onCreateTask,
    onUndo,
    onRestore,
    onDeleteArchived,
    onIntent,
    onOpenTask,
    onEditSource,
    onComment,
    onOpenPeoplePanel,
  } = props
  const [section, setSection] = useState<Exclude<PhoneSection, 'settings'>>('tasks')
  const [detailPath, setDetailPath] = useState<string | null>(null)
  const [boardsOpen, setBoardsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const actions: TaskBoardActions = { onIntent, onOpenTask, onEditSource, onComment, onOpenPeoplePanel }
  const model = useMemo(() => buildBoardModel(groups, allTasks, allTasks, null), [allTasks, groups])
  const targets = useMemo<MoveTarget[]>(
    () => model.columns.flatMap((column) => (column.group ? [{ key: column.key, name: column.name, color: column.color, count: column.count }] : [])),
    [model.columns],
  )
  const me = board.members.find((member) => member.isMe)?.name ?? null
  const editBoard = canManageBoards ? onEditBoard : undefined

  const header = (extra: ReactNode, withSearch: boolean) => (
    <PhoneHeader
      boardName={board.name}
      boardColor={board.color}
      boardCount={viewMode === 'management' ? null : board.counts.active}
      onOpenBoards={() => setBoardsOpen(true)}
      search={withSearch ? {
        open: searchOpen,
        query,
        resultLabel: resultCount === null ? null : resultCount === 1 ? '1 resultado' : `${resultCount} resultados`,
        onToggle: () => {
          if (searchOpen) onQueryChange('')
          setSearchOpen(!searchOpen)
        },
        onChange: onQueryChange,
      } : undefined}
      onEditBoard={editBoard}
      viewMode={viewMode}
      onViewModeChange={onViewModeChange}
    >
      {extra}
    </PhoneHeader>
  )

  const openDetail = (path: string) => setDetailPath(path)
  const detailTask = detailPath ? model.taskByPath.get(detailPath) ?? null : null
  const selectSection = (next: PhoneSection) => {
    if (next === 'settings') {
      onEditBoard()
      return
    }
    setDetailPath(null)
    setSection(next)
  }

  let screen: ReactNode
  if (detailPath) {
    screen = (
      <PhoneTaskDetail
        key={detailPath}
        task={detailTask}
        subtasks={model.subtasksByParent.get(detailPath) ?? []}
        board={board}
        columnColor={model.columns.find((column) => column.groupName === detailTask?.group)?.color ?? 'var(--tm-slate)'}
        targets={targets}
        context={context}
        generation={generation}
        onIntent={onIntent}
        onBack={() => setDetailPath(null)}
        onOpenNote={onOpenTask}
        onUndo={onUndo}
      />
    )
  } else if (section === 'pomodoro') {
    screen = (
      <div className="tmp-screen">
        <header className="tmp-header tmp-header--plain">
          <div className="tmp-title-row"><h1 className="tmp-screen-title">Pomodoro</h1></div>
        </header>
        <main className="tmp-main tmp-main--pomodoro">{pomodoro}</main>
      </div>
    )
  } else if (section === 'archive') {
    screen = (
      <PhoneArchive
        boardName={board.name}
        finished={archive.finished.filter((row) => row.board === board.name)}
        cancelled={archive.cancelled.filter((row) => row.board === board.name)}
        onRestore={onRestore}
        onDelete={onDeleteArchived}
      />
    )
  } else if (viewMode === 'list') {
    screen = (
      <PhoneList
        {...actions}
        groups={groups}
        tasks={tasks}
        allTasks={allTasks}
        searching={query.trim().length > 0}
        me={me}
        flashTaskId={flashTaskId}
        renderHeader={(filters) => header(filters, true)}
        onCreateTask={() => onCreateTask()}
        onOpenDetail={openDetail}
      />
    )
  } else if (viewMode === 'management') {
    screen = (
      <PhoneManagement
        view={management.view}
        loading={management.loading}
        error={management.error}
        request={managementRequest}
        onRequestChange={onManagementRequestChange}
        onOpenTask={openDetail}
        renderHeader={(extra) => header(extra, false)}
      />
    )
  } else {
    screen = (
      <PhoneBoard
        {...actions}
        key={board.name}
        groups={groups}
        tasks={tasks}
        allTasks={allTasks}
        searching={query.trim().length > 0}
        flashTaskId={flashTaskId}
        renderHeader={(chips) => header(chips, true)}
        onCreateTask={(groupName) => onCreateTask(groupName)}
        onOpenDetail={openDetail}
      />
    )
  }

  return (
    <div className={`tmp-root${detailPath ? ' is-detail' : ''}`}>
      {screen}
      {detailPath ? null : (
        <PhoneBottomNav
          section={section}
          archiveCount={finishedCount}
          pomodoroRunning={pomodoroRunning}
          canEditBoard={canManageBoards}
          onSelect={selectSection}
        />
      )}
      {boardsOpen ? (
        <PhoneBoardsSheet
          boards={boards}
          activeBoard={board.name}
          onEditBoard={editBoard ? () => { setBoardsOpen(false); onEditBoard() } : undefined}
          onNewBoard={canManageBoards ? () => { setBoardsOpen(false); onNewBoard() } : undefined}
          onSelect={(name) => { setBoardsOpen(false); setDetailPath(null); onSelectBoard(name) }}
          onClose={() => setBoardsOpen(false)}
        />
      ) : null}
    </div>
  )
}

