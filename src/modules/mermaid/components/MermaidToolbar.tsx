import { memo } from 'react'
import { Square, Smile, Image, Type } from 'lucide-react'

export type MermaidToolKind = 'shapes' | 'icons' | 'image' | 'text' | null

interface MermaidToolbarProps {
  activeTool: MermaidToolKind
  onToolChange: (tool: MermaidToolKind) => void
  shapesTriggerRef?: React.Ref<HTMLButtonElement>
  iconsTriggerRef?: React.Ref<HTMLButtonElement>
  imageTriggerRef?: React.Ref<HTMLButtonElement>
  textTriggerRef?: React.Ref<HTMLButtonElement>
}

const TOOLS = [
  { id: 'shapes' as const, label: 'Formas', icon: Square },
  { id: 'icons' as const, label: 'Iconos', icon: Smile },
  { id: 'image' as const, label: 'Imagen', icon: Image },
  { id: 'text' as const, label: 'Texto', icon: Type },
]

export const MermaidToolbar = memo(function MermaidToolbar({
  activeTool,
  onToolChange,
  shapesTriggerRef,
  iconsTriggerRef,
  imageTriggerRef,
  textTriggerRef,
}: MermaidToolbarProps) {
  const refs = [shapesTriggerRef, iconsTriggerRef, imageTriggerRef, textTriggerRef]
  return (
    <div className="mermaid-floating-toolbar">
      {TOOLS.map((tool, index) => {
        const Icon = tool.icon
        const isActive = activeTool === tool.id
        return (
          <button
            key={tool.id}
            ref={refs[index]}
            className={`mermaid-floating-toolbar-btn${isActive ? ' is-active' : ''}`}
            title={tool.label}
            onClick={() => onToolChange(isActive ? null : tool.id)}
          >
            <Icon size={16} />
          </button>
        )
      })}
    </div>
  )
})
MermaidToolbar.displayName = 'MermaidToolbar'
