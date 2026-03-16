import { useEffect, useRef, useState } from 'react'
import { getDrawioEditorManager } from '../../../../modules/drawio/services/drawioEditorManager'
import type { DrawioDocumentController } from '../../../../modules/drawio/types'

interface DrawioViewProps {
  filePath: string
  source: string
  onSourcePersist: (filePath: string, nextSource: string) => Promise<void>
  onControllerReady?: (controller: DrawioDocumentController | null) => void
}

export function DrawioView({
  filePath,
  source,
  onSourcePersist,
  onControllerReady,
}: DrawioViewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const sourceRef = useRef(source)
  const onSourcePersistRef = useRef(onSourcePersist)
  const onControllerReadyRef = useRef(onControllerReady)

  useEffect(() => {
    sourceRef.current = source
  }, [source])

  useEffect(() => {
    onSourcePersistRef.current = onSourcePersist
  }, [onSourcePersist])

  useEffect(() => {
    onControllerReadyRef.current = onControllerReady
  }, [onControllerReady])

  useEffect(() => {
    const mountElement = mountRef.current
    if (!mountElement) {
      return
    }

    const manager = getDrawioEditorManager()
    const controller: DrawioDocumentController = {
      flush: () => manager.flush(filePath),
    }

    let cancelled = false
    onControllerReadyRef.current?.(controller)

    void manager.attach(mountElement, {
      path: filePath,
      name: filePath.split(/[\\/]/).pop() ?? filePath,
      source: sourceRef.current,
      onPersistSource: (nextSource) => onSourcePersistRef.current(filePath, nextSource),
    })
      .then(() => {
        if (!cancelled) {
          setErrorMessage(null)
        }
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        setErrorMessage(error instanceof Error ? error.message : 'No se pudo abrir el editor draw.io.')
        onControllerReadyRef.current?.(null)
      })

    return () => {
      cancelled = true
      onControllerReadyRef.current?.(null)
      void manager.detach(filePath, { flush: true })
    }
  }, [filePath])

  return (
    <div className="notia-drawio-view">
      <div ref={mountRef} className="notia-drawio-mount" />
      {errorMessage ? (
        <div className="notia-drawio-error">
          <strong>draw.io no pudo iniciarse</strong>
          <span>{errorMessage}</span>
        </div>
      ) : null}
    </div>
  )
}
