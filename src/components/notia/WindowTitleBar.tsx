import { useCallback, useEffect, useRef, useState, type ComponentType, type MouseEvent } from 'react'
import { ChevronLeft, ChevronRight, Moon, Sun } from 'lucide-react'
import { startWindowDragging, startWindowDraggingWithRestore } from '../../services/window/windowRuntime'
import type { NotiaIconAction } from '../../types/notia'
import { NotiaButton } from '../common/NotiaButton'
import { useSubmenuEngine } from '../../hooks/useSubmenuEngine'

interface WindowTitleTab {
  path: string
  title: string
}

interface WindowTitleBarProps {
  tabs: WindowTitleTab[]
  activeTabPath: string | null
  tabIcon: ComponentType<{ size?: number }>
  onActivateTab: (tabPath: string) => void
  onCloseTab: (tabPath: string) => void
  isSidebarOpen: boolean
  onToggleSidebar: () => void
  explorerActions: NotiaIconAction[]
  explorerTools: NotiaIconAction[]
  activeExplorerActionId: string
  isSearchMenuOpen: boolean
  searchQuery: string
  searchResultCount: number
  isSearchLoading: boolean
  onExplorerActionClick: (id: string) => void
  onExplorerToolClick: (id: string) => void
  onSearchQueryChange: (value: string) => void
  onSearchMenuClose: () => void
  rightActions: NotiaIconAction[]
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onWindowAction: (action: NotiaWindowAction) => void
}

export function WindowTitleBar({
  tabs,
  activeTabPath,
  tabIcon: TabIcon,
  onActivateTab,
  onCloseTab,
  isSidebarOpen,
  onToggleSidebar,
  explorerActions,
  explorerTools,
  activeExplorerActionId,
  isSearchMenuOpen,
  searchQuery,
  searchResultCount,
  isSearchLoading,
  onExplorerActionClick,
  onExplorerToolClick,
  onSearchQueryChange,
  onSearchMenuClose,
  rightActions,
  theme,
  onToggleTheme,
  onWindowAction,
}: WindowTitleBarProps) {
  const DRAG_START_DELAY_MS = 170
  const DRAG_MOVE_THRESHOLD_PX = 8
  const tabsScrollRef = useRef<HTMLDivElement>(null)
  const tabElementRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const searchInputRef = useRef<HTMLInputElement>(null)
  const pendingDragStartTimeoutRef = useRef<number | null>(null)
  const titlebarPressStartPointRef = useRef<{ x: number; y: number } | null>(null)
  const isTitlebarPressActiveRef = useRef(false)
  const hasStartedWindowDragRef = useRef(false)
  const [isTabsOverflowing, setIsTabsOverflowing] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const { triggerRef: searchButtonRef, panelRef: searchMenuRef } = useSubmenuEngine<HTMLButtonElement, HTMLDivElement>({
    open: isSearchMenuOpen,
    onClose: onSearchMenuClose,
  })

  const ToggleIcon = explorerActions[0]?.icon
  const ThemeIcon = theme === 'dark' ? Sun : Moon
  const themeLabel = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
  const blockingSelector =
    'button, input, textarea, select, a, [role="button"], .notia-tab, .notia-tab-trigger, .notia-toolbar, .notia-explorer-actions, .notia-titlebar-controls, .notia-titlebar-tabs-scroll-button, .notia-search-panel'

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
    if (!isSearchMenuOpen) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isSearchMenuOpen])

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
    >
      <div
        className={`notia-titlebar-sidebar ${
          isSidebarOpen ? 'notia-titlebar-sidebar--open' : 'notia-titlebar-sidebar--closed'
        }`}
      >
        <div className="notia-titlebar-rail-slot">
          <NotiaButton
            size="icon"
            variant={isSidebarOpen ? 'primary' : 'secondary'}
            className={`notia-icon-button ${isSidebarOpen ? 'notia-icon-button--active' : ''}`}
            title="Toggle sidebar"
            onClick={onToggleSidebar}
          >
            {ToggleIcon ? <ToggleIcon size={16} /> : null}
          </NotiaButton>
        </div>
        {isSidebarOpen ? (
          <div className="notia-titlebar-explorer">
            <div className="notia-explorer-actions">
              {explorerActions.slice(1).map(({ id, label, icon: Icon }) => (
                <div key={id} className="notia-explorer-action-slot">
                  <NotiaButton
                    ref={id === 'search' ? searchButtonRef : undefined}
                    size="icon"
                    variant={activeExplorerActionId === id ? 'primary' : 'secondary'}
                    className={`notia-toolbar-button notia-toolbar-button--${id} ${
                      activeExplorerActionId === id ? 'notia-icon-button--active' : ''
                    }`}
                    title={label}
                    onClick={() => onExplorerActionClick(id)}
                  >
                    <Icon size={15} />
                  </NotiaButton>
                  {id === 'search' && isSearchMenuOpen ? (
                    <div ref={searchMenuRef} className="notia-search-panel">
                      <div className="notia-search-panel-title">Buscar en libreria</div>
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        className="notia-search-panel-input"
                        placeholder="Buscar por titulo o contenido..."
                        onChange={(event) => onSearchQueryChange(event.target.value)}
                      />
                      <div className="notia-search-panel-meta">
                        {isSearchLoading
                          ? 'Buscando...'
                          : searchQuery.trim()
                            ? `${searchResultCount} coincidencia${searchResultCount === 1 ? '' : 's'}`
                            : 'Escribi para buscar en la libreria.'}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="notia-toolbar">
              {explorerTools.map(({ id, label, icon: Icon }) => (
                <NotiaButton
                  key={id}
                  size="icon"
                  variant="secondary"
                  className={`notia-toolbar-button notia-toolbar-button--${id}`}
                  title={label}
                  onClick={() => onExplorerToolClick(id)}
                >
                  <Icon size={15} />
                </NotiaButton>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="notia-titlebar-main">
        <div className="notia-titlebar-tabs-shell">
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
          <div className="notia-titlebar-tabs" ref={tabsScrollRef}>
            {tabs.length === 0 ? (
              <div className="notia-tab notia-tab--active notia-tab--placeholder">
                <TabIcon size={14} />
                <span className="notia-tab-title">New tab</span>
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
                  >
                    <NotiaButton
                      variant="ghost"
                      className="notia-tab-trigger"
                      title={tab.title}
                      onClick={() => onActivateTab(tab.path)}
                    >
                      <TabIcon size={14} />
                      <span className="notia-tab-title">{tab.title}</span>
                    </NotiaButton>
                    <NotiaButton
                      size="icon"
                      variant="ghost"
                      className="notia-titlebar-button notia-tab-close"
                      title="Close tab"
                      onClick={() => onCloseTab(tab.path)}
                    >
                      ×
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

        <div className="notia-titlebar-controls">
          <NotiaButton size="icon" variant="ghost" className="notia-titlebar-button" title={themeLabel} onClick={onToggleTheme}>
            <ThemeIcon size={15} />
          </NotiaButton>
          {rightActions.length > 0 ? <div className="notia-titlebar-separator" /> : null}
          {rightActions.map(({ id, label, icon: Icon }) => (
            <NotiaButton
              key={id}
              size="icon"
              variant={id === 'close' ? 'danger' : 'ghost'}
              className={`notia-titlebar-button ${id === 'close' ? 'notia-titlebar-close' : ''}`}
              title={label}
              onClick={() => {
                if (id === 'minimize' || id === 'maximize' || id === 'close') {
                  onWindowAction(id)
                }
              }}
            >
              <Icon size={15} />
            </NotiaButton>
          ))}
        </div>
      </div>
    </header>
  )
}
