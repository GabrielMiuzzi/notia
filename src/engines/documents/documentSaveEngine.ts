import { isTextFileDocument } from '../../types/views/fileDocument'
import type { OpenDocumentTab } from '../../features/documents/documentsTypes'

export function getDirtyOpenTextDocumentPaths(openTabs: OpenDocumentTab[]): string[] {
  return openTabs
    .filter((tab) => isTextFileDocument(tab.document) && tab.document.source !== tab.latestSavedSource)
    .map((tab) => tab.document.path)
}
