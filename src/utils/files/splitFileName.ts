export interface FileNameParts {
  baseName: string
  extension: string
}

export function splitFileName(fileName: string): FileNameParts {
  const lastDotIndex = fileName.lastIndexOf('.')

  if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
    return { baseName: fileName, extension: '' }
  }

  return {
    baseName: fileName.slice(0, lastDotIndex),
    extension: fileName.slice(lastDotIndex),
  }
}

export function joinFileName(baseName: string, extension: string): string {
  return `${baseName}${extension}`
}
