export interface TaskManagerMutationEvent {
  vaultPath: string
  changedPaths: string[]
  forceFullReload?: boolean
}

type TaskManagerMutationListener = (event: TaskManagerMutationEvent) => void

const listeners = new Set<TaskManagerMutationListener>()

export function subscribeTaskManagerMutations(listener: TaskManagerMutationListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function dispatchTaskManagerMutation(
  vaultPath: string,
  changedPaths: string[] = [],
  options?: { forceFullReload?: boolean },
): void {
  const event = { vaultPath, changedPaths, forceFullReload: options?.forceFullReload }
  for (const listener of listeners) {
    listener(event)
  }
}
