export interface SelectedImageAttachment {
  name: string
  mimeType: string
  base64: string
}

export function readImageFileAsAttachment(file: File): Promise<SelectedImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      reject(new Error('No se pudo leer la imagen seleccionada.'))
    }
    reader.onload = () => {
      const rawResult = typeof reader.result === 'string' ? reader.result : ''
      const commaIndex = rawResult.indexOf(',')
      const base64 = commaIndex >= 0 ? rawResult.slice(commaIndex + 1) : rawResult
      if (!base64.trim()) {
        reject(new Error('No se pudo procesar la imagen seleccionada.'))
        return
      }

      resolve({
        name: file.name || 'imagen',
        mimeType: file.type || 'image/png',
        base64,
      })
    }
    reader.readAsDataURL(file)
  })
}
