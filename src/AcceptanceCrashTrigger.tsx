import { useEffect, useState } from 'react'

// Step 14 (RUNTIME-09): the only way to deterministically browser-test
// ErrorBoundary's real render path is to actually throw during a render,
// which requires a component ErrorBoundary wraps. Registers a single global
// trigger function, exactly like every other acceptance-fixture surface in
// this codebase, so it exists only when VITE_ACCEPTANCE_FIXTURES=true --
// there is no user-reachable "crash me" control in a normal production
// build.
export function AcceptanceCrashTrigger() {
  const [crashed, setCrashed] = useState(false)

  useEffect(() => {
    if (import.meta.env.VITE_ACCEPTANCE_FIXTURES !== 'true') return
    const target = window as Window & { __financePlannerCrashForAcceptance?: () => void }
    target.__financePlannerCrashForAcceptance = () => setCrashed(true)
    return () => { delete target.__financePlannerCrashForAcceptance }
  }, [])

  if (crashed) throw new Error('Acceptance-triggered crash for ErrorBoundary evidence')
  return null
}
