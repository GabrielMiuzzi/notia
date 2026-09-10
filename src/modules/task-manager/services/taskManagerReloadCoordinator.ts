export interface TaskManagerReloadDrainState {
  pending: boolean
  inFlight: Promise<void> | null
}

const RELOAD_RETRY_BASE_DELAY_MS = 250
const RELOAD_RETRY_MAX_DELAY_MS = 10_000

export function getTaskManagerReloadRetryDelay(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0
  return Math.min(RELOAD_RETRY_MAX_DELAY_MS, RELOAD_RETRY_BASE_DELAY_MS * (2 ** Math.min(safeAttempt, 6)))
}

/**
 * Keeps one reload drain active until every request observed during its
 * completion boundary has been consumed. Callers may safely join the same
 * drain; one of them will start the next pass if work arrived after the
 * previous runner had already decided to finish.
 */
export async function drainTaskManagerReloadQueue(
  state: TaskManagerReloadDrainState,
  createDrain: () => Promise<void>,
): Promise<void> {
  while (state.pending || state.inFlight) {
    if (!state.inFlight) {
      const execution = createDrain()
      const trackedExecution: Promise<void> = execution.finally(() => {
        if (state.inFlight === trackedExecution) {
          state.inFlight = null
        }
      })
      state.inFlight = trackedExecution
    }
    await state.inFlight
  }
}
