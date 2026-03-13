declare const __NOTIA_APP_VERSION__: string | undefined

const DEFAULT_APP_VERSION = '0.0.0'

export function getAppVersion(): string {
  const version = __NOTIA_APP_VERSION__
  if (typeof version !== 'string') {
    return DEFAULT_APP_VERSION
  }

  const normalizedVersion = version.trim()
  return normalizedVersion.length > 0 ? normalizedVersion : DEFAULT_APP_VERSION
}
