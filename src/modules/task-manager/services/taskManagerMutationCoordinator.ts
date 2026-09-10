export interface TaskManagerMutationContext {
  actorId: 'host'
  operationId: string
}

let mutationQueue: Promise<void> = Promise.resolve()
let operationSequence = 0

function createHostOperationId(): string {
  operationSequence = (operationSequence + 1) % Number.MAX_SAFE_INTEGER
  return `host-${Date.now().toString(36)}-${operationSequence.toString(36)}`
}

/**
 * Serializes every host-side Task Manager mutation while allowing the caller
 * to observe the original result or error. The queue itself always recovers
 * so one failed mutation cannot permanently block later user actions.
 */
export function enqueueTaskManagerMutation<T>(
  runner: (context: TaskManagerMutationContext) => Promise<T>,
): Promise<T> {
  const context: TaskManagerMutationContext = {
    actorId: 'host',
    operationId: createHostOperationId(),
  }
  const execution = mutationQueue.then(
    () => runner(context),
    () => runner(context),
  )
  mutationQueue = execution.then(
    () => undefined,
    () => undefined,
  )
  return execution
}
