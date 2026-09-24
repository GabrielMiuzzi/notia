import { memo, useCallback, useEffect, useRef, useState, type ComponentType, type MouseEvent } from 'react'
import { ChevronLeft, ChevronRight, Moon, PanelLeft, PanelRight, Sun, X } from 'lucide-react'
import { startWindowDragging, startWindowDraggingWithRestore } from '../../services/window/windowRuntime'
import type { NotiaIconAction } from '../../types/notia'
import { NotiaButton } from '../common/NotiaButton'
import { useAppSelector } from '../../store/hooks'
import { selectIsSidebarOpen, selectIsRightChatPanelOpen } from '../../features/ui/uiSelectors'
import { selectTheme } from '../../features/preferences/preferencesSelectors'
import { selectActiveTabPath, selectTitleBarTabs } from '../../features/documents/documentsSelectors'
import { useNotiaAction } from '../../context/notiaActions/useNotiaAction'

interface WindowTitleBarProps {
  tabIcon: ComponentType<{ size?: number; strokeWidth?: number }>
  rightActions: NotiaIconAction[]
  showRightPanelToggle?: boolean
}

function WindowTitleBarComponent({
  tabIcon: TabIcon,
  rightActions,
  showRightPanelToggle = true,
}: WindowTitleBarProps) {
  const tabs = useAppSelector(selectTitleBarTabs)
  const activeTabPath = useAppSelector(selectActiveTabPath)
  const isSidebarOpen = useAppSelector(selectIsSidebarOpen)
  const theme = useAppSelector(selectTheme)
  const isRightPanelOpen = useAppSelector(selectIsRightChatPanelOpen)

  const onActivateTab = useNotiaAction('activateTab')
  const onCloseTab = useNotiaAction('closeTab')
  const onToggleSidebar = useNotiaAction('toggleSidebar')
  const onToggleTheme = useNotiaAction('toggleTheme')
  const onToggleRightPanel = useNotiaAction('toggleRightChatPanel')
  const onWindowAction = useNotiaAction('windowAction')

  const DRAG_START_DELAY_MS = 170
  const DRAG_MOVE_THRESHOLD_PX = 8
  const tabsScrollRef = useRef<HTMLDivElement>(null)
  const tabElementRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const pendingDragStartTimeoutRef = useRef<number | null>(null)
  const titlebarPressStartPointRef = useRef<{ x: number; y: number } | null>(null)
  const isTitlebarPressActiveRef = useRef(false)
  const hasStartedWindowDragRef = useRef(false)
  const [isTabsOverflowing, setIsTabsOverflowing] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const ThemeIcon = theme === 'dark' ? Sun : Moon
  const themeLabel = theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'
  const sidebarLabel = isSidebarOpen ? 'Ocultar explorador' : 'Mostrar explorador'
  const rightPanelLabel = isRightPanelOpen ? 'Ocultar asistente' : 'Mostrar asistente'
  const blockingSelector =
    'button, input, textarea, select, a, [role="button"], .notia-tab, .notia-tab-trigger, .notia-titlebar-controls, .notia-titlebar-tabs-scroll-button'

  const isInteractiveTitlebarTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) {
      return true
    }

    return Boolean(target.closest(blockingSelector))
  }

  const updateTabsScrollState = useCallback(() => {
    const tabsScrollElement = tabsScrollRef.current
    if (!tabsScrollElement) {
      setIsTabsOverflowing(false)
      setCanScrollLeft(false)
      setCanScrollRight(false)
      return
    }

    const maxScrollLeft = tabsScrollElement.scrollWidth - tabsScrollElement.clientWidth
    const isOverflowing = maxScrollLeft > 1

    setIsTabsOverflowing(isOverflowing)
    setCanScrollLeft(isOverflowing && tabsScrollElement.scrollLeft > 1)
    setCanScrollRight(isOverflowing && tabsScrollElement.scrollLeft < maxScrollLeft - 1)
  }, [])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      updateTabsScrollState()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [tabs.length, isSidebarOpen, updateTabsScrollState])

  useEffect(() => {
    const tabsScrollElement = tabsScrollRef.current
    if (!tabsScrollElement) {
      return
    }

    const handleScroll = () => {
      updateTabsScrollState()
    }

    tabsScrollElement.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll)

    return () => {
      tabsScrollElement.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [updateTabsScrollState])

  useEffect(() => {
    if (!activeTabPath) {
      return
    }

    const activeTabElement = tabElementRefs.current[activeTabPath]
    if (!activeTabElement) {
      return
    }

    activeTabElement.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    })

    window.setTimeout(updateTabsScrollState, 180)
  }, [activeTabPath, tabs.length, updateTabsScrollState])

  useEffect(() => {
    return () => {
      if (pendingDragStartTimeoutRef.current !== null) {
        window.clearTimeout(pendingDragStartTimeoutRef.current)
        pendingDragStartTimeoutRef.current = null
      }
    }
  }, [])

  const handleTitlebarMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return
    }

    if (isInteractiveTitlebarTarget(event.target)) {
      return
    }

    event.preventDefault()
    isTitlebarPressActiveRef.current = true
    hasStartedWindowDragRef.current = false
    titlebarPressStartPointRef.current = { x: event.clientX, y: event.clientY }
    if (pendingDragStartTimeoutRef.current !== null) {
      window.clearTimeout(pendingDragStartTimeoutRef.current)
      pendingDragStartTimeoutRef.current = null
    }
    pendingDragStartTimeoutRef.current = window.setTimeout(() => {
      pendingDragStartTimeoutRef.current = null
      void startWindowDragging()
    }, DRAG_START_DELAY_MS)
  }

  const resetTitlebarPressState = () => {
    isTitlebarPressActiveRef.current = false
    hasStartedWindowDragRef.current = false
    titlebarPressStartPointRef.current = null
  }

  const cancelPendingWindowDrag = () => {
    if (pendingDragStartTimeoutRef.current === null) {
      resetTitlebarPressState()
      return
    }
    window.clearTimeout(pendingDragStartTimeoutRef.current)
    pendingDragStartTimeoutRef.current = null
    resetTitlebarPressState()
  }

  const handleTitlebarMouseMove = (event: MouseEvent<HTMLElement>) => {
    if (!isTitlebarPressActiveRef.current || hasStartedWindowDragRef.current) {
      return
    }
    if ((event.buttons & 1) !== 1) {
      cancelPendingWindowDrag()
      return
    }
    const startPoint = titlebarPressStartPointRef.current
    if (!startPoint) {
      return
    }
    const deltaX = event.clientX - startPoint.x
    const deltaY = event.clientY - startPoint.y
    if ((deltaX * deltaX) + (deltaY * deltaY) < (DRAG_MOVE_THRESHOLD_PX * DRAG_MOVE_THRESHOLD_PX)) {
      return
    }
    if (pendingDragStartTimeoutRef.current !== null) {
      window.clearTimeout(pendingDragStartTimeoutRef.current)
      pendingDragStartTimeoutRef.current = null
    }
    hasStartedWindowDragRef.current = true
    event.preventDefault()
    void startWindowDraggingWithRestore()
  }

  const handleTitlebarDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return
    }

    if (isInteractiveTitlebarTarget(event.target)) {
      return
    }

    event.preventDefault()
    cancelPendingWindowDrag()
    onWindowAction('maximize')
  }

  const handleScrollTabs = (direction: 'left' | 'right') => {
    const tabsScrollElement = tabsScrollRef.current
    if (!tabsScrollElement) {
      return
    }

    const delta = Math.max(180, Math.floor(tabsScrollElement.clientWidth * 0.45))
    tabsScrollElement.scrollBy({
      left: direction === 'left' ? -delta : delta,
      behavior: 'smooth',
    })
  }

  return (
    <header
      className="notia-titlebar"
      onMouseDown={handleTitlebarMouseDown}
      onMouseMove={handleTitlebarMouseMove}
      onMouseUp={cancelPendingWindowDrag}
      onMouseLeave={cancelPendingWindowDrag}
      onDoubleClick={handleTitlebarDoubleClick}
      data-notia-prevent-menu-close
    >
      <div className="notia-titlebar-main" data-notia-prevent-menu-close>
        <div className="notia-titlebar-tabs-shell" data-notia-prevent-menu-close>
          {isTabsOverflowing ? (
            <NotiaButton
              size="icon"
              variant="ghost"
              className="notia-titlebar-tabs-scroll-button"
              title="Ver pestanas anteriores"
              onClick={() => handleScrollTabs('left')}
              disabled={!canScrollLeft}
            >
              <ChevronLeft size={14} />
            </NotiaButton>
          ) : null}
          <div className="notia-titlebar-tabs" ref={tabsScrollRef} data-notia-prevent-menu-close>
            {tabs.length === 0 ? (
              <div className="notia-tab notia-tab--active notia-tab--placeholder" data-notia-prevent-menu-close>
                <TabIcon size={14} strokeWidth={1.75} />
                <span className="notia-tab-title">Nueva pestaña</span>
              </div>
            ) : (
              tabs.map((tab) => {
                const isActive = tab.path === activeTabPath
                return (
                  <div
                    key={tab.path}
                    ref={(element) => {
                      tabElementRefs.current[tab.path] = element
                    }}
                    className={`notia-tab ${isActive ? 'notia-tab--active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                    data-notia-prevent-menu-close
                  >
                    <NotiaButton
                      variant="ghost"
                      className="notia-tab-trigger"
                      title={tab.title}
                      onClick={() => onActivateTab(tab.path)}
                    >
                      <TabIcon size={14} strokeWidth={1.75} />
                      <span className="notia-tab-title">{tab.title}</span>
                    </NotiaButton>
                    <NotiaButton
                      size="icon"
                      variant="ghost"
                      className="notia-tab-close"
                      title="Cerrar pestaña"
                      aria-label={`Cerrar ${tab.title}`}
                      onClick={() => onCloseTab(tab.path)}
                    >
                      <X size={12} strokeWidth={2} />
                    </NotiaButton>
                  </div>
                )
              })
            )}
          </div>
          {isTabsOverflowing ? (
            <NotiaButton
              size="icon"
              variant="ghost"
              className="notia-titlebar-tabs-scroll-button"
              title="Ver pestanas siguientes"
              onClick={() => handleScrollTabs('right')}
              disabled={!canScrollRight}
            >
              <ChevronRight size={14} />
            </NotiaButton>
          ) : null}
        </div>

        <div className="notia-titlebar-controls" data-notia-prevent-menu-close>
          <NotiaButton
            size="icon"
            variant="ghost"
            className="notia-titlebar-button notia-titlebar-theme-button"
            title={themeLabel}
            aria-label={themeLabel}
            onClick={onToggleTheme}
          >
            <ThemeIcon size={16} strokeWidth={1.75} />
          </NotiaButton>
          <NotiaButton
            size="icon"
            variant="ghost"
            className={`notia-titlebar-button notia-titlebar-sidebar-button ${
              isSidebarOpen ? 'notia-titlebar-button--active' : ''
            }`}
            title={sidebarLabel}
            aria-label={sidebarLabel}
            aria-pressed={isSidebarOpen}
            onClick={onToggleSidebar}
          >
            <PanelLeft size={16} strokeWidth={1.75} />
          </NotiaButton>
          {showRightPanelToggle ? (
            <NotiaButton
              size="icon"
              variant="ghost"
              className={`notia-titlebar-button notia-titlebar-right-panel-button ${
                isRightPanelOpen ? 'notia-titlebar-button--active' : ''
              }`}
              title={rightPanelLabel}
              aria-label={rightPanelLabel}
              aria-pressed={isRightPanelOpen}
              onClick={onToggleRightPanel}
            >
              <PanelRight size={16} strokeWidth={1.75} />
            </NotiaButton>
          ) : null}
          {rightActions.length > 0 ? <div className="notia-titlebar-separator" /> : null}
          {rightActions.map(({ id, label, icon: Icon }) => (
            <NotiaButton
              key={id}
              size="icon"
              variant="ghost"
              className={`notia-titlebar-button ${id === 'close' ? 'notia-titlebar-close' : ''}`}
              title={label}
              aria-label={label}
              onClick={() => {
                if (id === 'minimize' || id === 'maximize' || id === 'close') {
                  onWindowAction(id)
                }
              }}
            >
              <Icon size={id === 'maximize' ? 13 : 15} strokeWidth={1.75} />
            </NotiaButton>
          ))}
        </div>
      </div>
    </header>
  )
}

export const WindowTitleBar = memo(WindowTitleBarComponent)
WindowTitleBar.displayName = 'WindowTitleBar'
