function normalizeSlashSeparators(value: string): string {
  const withForwardSlashes = value.replace(/\\/g, '/')

  if (withForwardSlashes.startsWith('//')) {
    return `//${withForwardSlashes.slice(2).replace(/\/+/g, '/')}`
  }

  return withForwardSlashes.replace(/\/+/g, '/')
}

export function normalizeFilesystemPath(pathValue: string): string {
  const trimmed = pathValue.trim()
  if (!trimmed) {
    return trimmed
  }

  if (!trimmed.startsWith('file://')) {
    return normalizeSlashSeparators(trimmed)
  }

  try {
    const parsedUrl = new URL(trimmed)
    if (parsedUrl.protocol !== 'file:') {
      return normalizeSlashSeparators(trimmed)
    }

    const decodedPathname = decodeURIComponent(parsedUrl.pathname)
    const normalizedWindowsPath = /^\/[A-Za-z]:\//.test(decodedPathname)
      ? decodedPathname.slice(1)
      : decodedPathname

    if (parsedUrl.hostname) {
      return normalizeSlashSeparators(`//${parsedUrl.hostname}${normalizedWindowsPath}`)
    }

    return normalizeSlashSeparators(normalizedWindowsPath || trimmed)
  } catch {
    return normalizeSlashSeparators(trimmed)
  }
}
