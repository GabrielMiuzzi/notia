type TaskManagerMutationListener = (vaultPath: string) => void

const listeners = new Set<TaskManagerMutationListener>()

export function subscribeTaskManagerMutations(listener: TaskManagerMutationListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function dispatchTaskManagerMutation(vaultPath: string): void {
  for (const listener of listeners) {
    listener(vaultPath)
  }
}
