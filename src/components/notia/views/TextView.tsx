interface TextViewProps {
  source: string
  onSourceChange: (nextSource: string) => void
}

export function TextView({ source, onSourceChange }: TextViewProps) {
  return (
    <div className="notia-text-view">
      <textarea
        className="notia-text-editor"
        value={source}
        onChange={(event) => onSourceChange(event.currentTarget.value)}
        spellCheck={false}
      />
    </div>
  )
}
