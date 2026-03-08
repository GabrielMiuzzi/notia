export function normalizeFilesystemPath(pathValue: string): string {
  const trimmed = pathValue.trim()
  if (!trimmed.startsWith('file://')) {
    return pathValue
  }

  try {
    const parsedUrl = new URL(trimmed)
    if (parsedUrl.protocol !== 'file:') {
      return pathValue
    }

    const decodedPathname = decodeURIComponent(parsedUrl.pathname)
    const normalizedWindowsPath = /^\/[A-Za-z]:\//.test(decodedPathname)
      ? decodedPathname.slice(1)
      : decodedPathname

    if (parsedUrl.hostname) {
      return `//${parsedUrl.hostname}${normalizedWindowsPath}`
    }

    return normalizedWindowsPath || pathValue
  } catch {
    return pathValue
  }
}
