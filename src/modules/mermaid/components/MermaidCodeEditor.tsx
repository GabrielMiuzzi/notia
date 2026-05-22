import { memo, useCallback } from 'react'
import TextField from '@mui/material/TextField'

interface MermaidCodeEditorProps {
  code: string
  onChange: (nextCode: string) => void
  hasError: boolean
}

export const MermaidCodeEditor = memo(function MermaidCodeEditor({
  code,
  onChange,
  hasError,
}: MermaidCodeEditorProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value)
    },
    [onChange],
  )

  return (
    <TextField
      multiline
      fullWidth
      variant="outlined"
      value={code}
      onChange={handleChange}
      placeholder="Ingresá tu diagrama Mermaid..."
      sx={{
        flex: 1,
        '& .MuiOutlinedInput-root': {
          height: '100%',
          alignItems: 'flex-start',
          padding: 0,
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize: 13,
          lineHeight: 1.6,
        },
        '& .MuiInputBase-input': {
          height: '100% !important',
          overflow: 'auto !important',
          resize: 'none',
          padding: '12px',
          color: 'var(--color-app-text)',
        },
        '& fieldset': {
          borderColor: hasError ? '#ff5555' : 'var(--color-border-soft)',
        },
      }}
    />
  )
})
MermaidCodeEditor.displayName = 'MermaidCodeEditor'
