import { Profiler, useCallback, type ProfilerOnRenderCallback, type ReactNode } from 'react'
import { recordPerformanceSample } from '../../services/runtime/performanceBaseline'

interface PerformanceProfilerProps {
  id: string
  children: ReactNode
}

export function PerformanceProfiler({ id, children }: PerformanceProfilerProps) {
  const handleRender = useCallback<ProfilerOnRenderCallback>(
    (profilerId, phase, actualDuration, baseDuration, startTime, commitTime) => {
      recordPerformanceSample(`render.${profilerId}`, actualDuration, {
        phase,
        actualDurationMs: actualDuration,
        baseDurationMs: baseDuration,
        commitDurationMs: Math.max(0, commitTime - startTime),
      })
    },
    [],
  )

  return (
    <Profiler id={id} onRender={handleRender}>
      {children}
    </Profiler>
  )
}
