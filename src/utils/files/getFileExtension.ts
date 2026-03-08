export function getFileExtension(fileNameOrPath: string): string {
  const normalizedPath = fileNameOrPath.replace(/\\/g, '/')
  const fileName = normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1)
  const lastDotIndex = fileName.lastIndexOf('.')

  if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
    return ''
  }

  return fileName.slice(lastDotIndex + 1).toLowerCase()
}
