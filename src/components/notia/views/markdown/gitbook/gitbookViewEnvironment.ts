import type { GitbookResolver } from './gitbookResolver'

/** What the GitBook node views need from the editor that hosts them. */
export interface GitbookViewEnvironment {
  resolver: GitbookResolver
  /** Opens a library file by the path the explorer shows. */
  openLibraryPath: (path: string) => void
  /** Address an `<img>` can load a library file from. */
  fileUrl: (path: string) => string
  /** Draws or edits a drawing; resolves with its SVG data address, or `null` when cancelled. */
  editDrawing: (source: string) => Promise<string | null>
  /** Shows Markdown read-only inside `host`; returns how to remove it. */
  renderMarkdown: (host: HTMLElement, markdown: string) => () => void
  /** Sends a prompt block's text to the side chat, in a new chat. */
  runPrompt: (text: string) => void
}
