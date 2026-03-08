import { convertFileSrc } from '@tauri-apps/api/core'

function encodePathSegments(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function toFallbackFileUrl(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/')

  if (/^[A-Za-z]:\//.test(normalizedPath)) {
    const drivePrefix = normalizedPath.slice(0, 2)
    const drivePath = normalizedPath.slice(2)
    return `file:///${drivePrefix}${encodePathSegments(drivePath)}`
  }

  if (normalizedPath.startsWith('/')) {
    return `file://${encodePathSegments(normalizedPath)}`
  }

  return `file://${encodePathSegments(`/${normalizedPath}`)}`
}

export function toFileUrl(filePath: string): string {
  try {
    return convertFileSrc(filePath)
  } catch {
    return toFallbackFileUrl(filePath)
  }
}
