const THEME_STORAGE_KEY = 'notia:theme'

export type NotiaTheme = 'dark' | 'light'

function isValidTheme(value: unknown): value is NotiaTheme {
  return value === 'dark' || value === 'light'
}

export function loadThemePreference(): NotiaTheme {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY)
  if (isValidTheme(storedTheme)) {
    return storedTheme
  }
  return 'dark'
}

export function saveThemePreference(theme: NotiaTheme) {
  localStorage.setItem(THEME_STORAGE_KEY, theme)
}
