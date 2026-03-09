// @ts-nocheck
declare global {
  interface Element {
    empty: () => void
    addClass: (...classNames: string[]) => void
    removeClass: (...classNames: string[]) => void
    toggleClass: (className: string, force?: boolean) => void
    setText: (text: string) => void
    setAttr: (key: string, value: string) => void
    createEl: <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: { cls?: string; text?: string; attr?: Record<string, string>; type?: string },
    ) => HTMLElementTagNameMap[K]
    createDiv: (options?: { cls?: string; text?: string; attr?: Record<string, string> }) => HTMLDivElement
    createSpan: (options?: { cls?: string; text?: string; attr?: Record<string, string> }) => HTMLSpanElement
  }
}

export {}
