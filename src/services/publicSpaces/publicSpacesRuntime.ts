import { callBackend } from '../transport'

/** Public spaces of this device, as Rust stores, validates and serves them. */

export type PublicSpaceItemKind = 'folder' | 'file'

export interface PublicSpaceItem {
  path: string
  kind: PublicSpaceItemKind
}

export interface PublicSpaceItemView extends PublicSpaceItem {
  name: string
  /** `false` when it lost the `#Publico` context. */
  public: boolean
}

export interface PublicSpaceView {
  id: string
  name: string
  libraryId: string
  port: number
  enabled: boolean
  items: PublicSpaceItemView[]
  listening: boolean
  url?: string
  error?: string
  pageCount: number
}

export interface PublicSpacesView {
  available: boolean
  spaces: PublicSpaceView[]
  suggestedPort: number
}

export interface PublicSpaceDraft {
  id: string
  name: string
  libraryId: string
  port: number
  enabled: boolean
  items: PublicSpaceItem[]
}

export interface PublicSpaceCandidate {
  path: string
  kind: PublicSpaceItemKind
  name: string
}

export function readPublicSpaces(): Promise<PublicSpacesView> {
  return callBackend<PublicSpacesView>('public_spaces_view')
}

/** Saves every space; Rust validates ports and contexts and restarts the servers. */
export function savePublicSpaces(spaces: PublicSpaceDraft[]): Promise<PublicSpacesView> {
  return callBackend<PublicSpacesView>('public_spaces_save', { payload: { spaces } })
}

/** Folders and notes of the library with the `#Publico` context, without
 * what `items` (the space, saved or not) already publishes. */
export function readPublicSpaceCandidates(libraryId: string, items: PublicSpaceItem[]): Promise<PublicSpaceCandidate[]> {
  return callBackend<PublicSpaceCandidate[]>('public_space_candidates', { payload: { libraryId, items } })
}

export async function openPublicSpace(id: string): Promise<void> {
  await callBackend('public_space_open', { payload: { id } })
}
