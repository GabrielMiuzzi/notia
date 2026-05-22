import { memo, useCallback, useState } from 'react'
import { Download, Image, FileCode, Copy, Check } from 'lucide-react'
import type { MermaidRenderResult } from '../types/mermaidTypes'

interface MermaidExportMenuProps {
  result: MermaidRenderResult | null
  theme: string
}

export const MermaidExportMenu = memo(function MermaidExportMenu({ result, theme }: MermaidExportMenuProps) {
  const [copied, setCopied] = useState(false)

  const handleExportSvg = useCallback(() => {
    if (!result?.svg) return
    let svg = result.svg
    if (!svg.includes('xmlns=')) {
      svg = svg.replace('<svg', `<svg xmlns="http://www.w3.org/2000/svg"`)
    }
    if (!svg.includes('xmlns:xlink')) {
      svg = svg.replace('<svg', `<svg xmlns:xlink="http://www.w3.org/1999/xlink"`)
    }
    // Fix self-closing tags
    svg = svg.replace(/<br>/g, '<br/>').replace(/<img([^\/>]*)>/g, '<img$1 />')

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'diagrama.svg'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [result])

  const handleExportPng = useCallback(() => {
    if (!result?.svg) return
    const parser = new DOMParser()
    const doc = parser.parseFromString(result.svg, 'image/svg+xml')
    const svgEl = doc.querySelector('svg')
    if (!svgEl) return

    // Fallback: read width/height attributes
    const widthAttr = svgEl.getAttribute('width') || svgEl.viewBox?.baseVal?.width || 800
    const heightAttr = svgEl.getAttribute('height') || svgEl.viewBox?.baseVal?.height || 600
    const width = typeof widthAttr === 'string' ? parseFloat(widthAttr) || 800 : widthAttr || 800
    const height = typeof heightAttr === 'string' ? parseFloat(heightAttr) || 600 : heightAttr || 600

    // Serialize
    const serializer = new XMLSerializer()
    let svgStr = serializer.serializeToString(svgEl)
    if (!svgStr.includes('xmlns=')) {
      svgStr = svgStr.replace('<svg', `<svg xmlns="http://www.w3.org/2000/svg"`)
    }

    const img = document.createElement('img')
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    img.onload = () => {
      const canvas = document.createElement('canvas')
      const scale = 2
      canvas.width = width * scale
      canvas.height = height * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Background based on theme
      const isDark = theme === 'dark'
      ctx.fillStyle = isDark ? '#1a1a2e' : '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return
        const pngUrl = URL.createObjectURL(pngBlob)
        const a = document.createElement('a')
        a.href = pngUrl
        a.download = 'diagrama.png'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(pngUrl)
      })
      URL.revokeObjectURL(url)
    }
    img.src = url
  }, [result, theme])

  const handleCopyImage = useCallback(() => {
    if (!result?.svg) return
    const parser = new DOMParser()
    const doc = parser.parseFromString(result.svg, 'image/svg+xml')
    const svgEl = doc.querySelector('svg')
    if (!svgEl) return

    const widthAttr = svgEl.getAttribute('width') || svgEl.viewBox?.baseVal?.width || 800
    const heightAttr = svgEl.getAttribute('height') || svgEl.viewBox?.baseVal?.height || 600
    const width = typeof widthAttr === 'string' ? parseFloat(widthAttr) || 800 : widthAttr || 800
    const height = typeof heightAttr === 'string' ? parseFloat(heightAttr) || 600 : heightAttr || 600

    const serializer = new XMLSerializer()
    let svgStr = serializer.serializeToString(svgEl)
    if (!svgStr.includes('xmlns=')) {
      svgStr = svgStr.replace('<svg', `<svg xmlns="http://www.w3.org/2000/svg"`)
    }

    const img = document.createElement('img')
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width * 2
      canvas.height = height * 2
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const isDark = theme === 'dark'
      ctx.fillStyle = isDark ? '#1a1a2e' : '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return
        try {
          const item = new ClipboardItem({ 'image/png': pngBlob })
          void navigator.clipboard.write([item])
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch (err) {
          console.error('[MermaidExportMenu] copy failed:', err)
        }
      })
      URL.revokeObjectURL(url)
    }
    img.src = url
  }, [result, theme])

  const [open, setOpen] = useState(false)

  const menuButtonStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 12,
    right: 12,
    zIndex: 10,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    borderRadius: 6,
    border: '1px solid var(--color-border-soft)',
    background: 'var(--color-card-bg)',
    color: 'var(--color-app-text)',
    cursor: 'pointer',
    padding: '0 10px',
    fontSize: 12,
    appearance: 'none',
  }

  const menuStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 44,
    right: 12,
    zIndex: 11,
    background: 'var(--color-card-bg)',
    border: '1px solid var(--color-border-soft)',
    borderRadius: 8,
    padding: '6px 0',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    display: open ? 'flex' : 'none',
    flexDirection: 'column',
    minWidth: 160,
  }

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    fontSize: 13,
    cursor: 'pointer',
    color: 'var(--color-app-text)',
    background: 'transparent',
    border: 'none',
    appearance: 'none',
    width: '100%',
    textAlign: 'left',
  }

  return (
    <>
      <div style={menuStyle}>
        <button style={itemStyle} onClick={handleExportPng}>
          <Image size={14} /> Descargar PNG
        </button>
        <button style={itemStyle} onClick={handleExportSvg}>
          <FileCode size={14} /> Descargar SVG
        </button>
        <button style={itemStyle} onClick={handleCopyImage}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copiado' : 'Copiar imagen'}
        </button>
      </div>
      <button style={menuButtonStyle} onClick={() => setOpen((o) => !o)}>
        <Download size={13} />
        <span>Exportar</span>
      </button>
    </>
  )
})
MermaidExportMenu.displayName = 'MermaidExportMenu'
