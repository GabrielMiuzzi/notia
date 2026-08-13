const RIGHT_PANEL_WIDTH_STORAGE_KEY = 'notia:right-panel-width'

export const DEFAULT_RIGHT_PANEL_WIDTH = 420
export const MIN_RIGHT_PANEL_WIDTH = 320
const MIN_WORKSPACE_WIDTH = 240

export function clampRightPanelWidth(width: number, viewportWidth: number): number {
  const maximumWidth = Math.max(
    MIN_RIGHT_PANEL_WIDTH,
    viewportWidth - MIN_WORKSPACE_WIDTH,
  )
  return Math.min(Math.max(Math.round(width), MIN_RIGHT_PANEL_WIDTH), maximumWidth)
}

export function loadRightPanelWidth(viewportWidth: number): number {
  try {
    const storedWidth = Number(window.localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY))
    return clampRightPanelWidth(
      Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : DEFAULT_RIGHT_PANEL_WIDTH,
      viewportWidth,
    )
  } catch {
    return clampRightPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH, viewportWidth)
  }
}

export function saveRightPanelWidth(width: number): void {
  try {
    window.localStorage.setItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, String(Math.round(width)))
  } catch {
    // The panel remains usable when storage is unavailable.
  }
}
