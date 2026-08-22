import { useEffect, useRef } from 'react'
import { loadEnableBankingAuthFlowWidget, ENABLE_BANKING_WIDGET_ELEMENT_TAG } from './enableBankingWidgetLoader'

export type EnableBankingAuthFlowStatus = 'loading' | 'ready' | 'error'

export interface EnableBankingAuthFlowProps {
  authorizationId: string
  origin: string
  sandbox: boolean
  locale?: string
  onStatusChange: (status: EnableBankingAuthFlowStatus) => void
  // Acceptance/browser-QA fixture escape hatch ONLY -- when set, this
  // component never contacts the real third-party script (production
  // acceptance runs must stay deterministic and must not depend on
  // reaching Enable Banking's CDN) and instead just reports the given
  // status immediately. Never set outside VITE_ACCEPTANCE_FIXTURES=true
  // fixture wiring in ConnectionsPage.tsx.
  fixtureStatus?: EnableBankingAuthFlowStatus
}

// Imperative custom-element creation rather than JSX: `enablebanking-auth-flow`
// is a third-party custom element with no React/TypeScript typings, and its
// `authorization`/`origin`/`locale`/`sandbox` are plain DOM attributes, not
// React props with change-diffing semantics Finance Planner wants -- a
// changed authorization/origin/sandbox means a different authorization
// attempt, which this component tears down and recreates wholesale rather
// than mutating in place. Creating it with the DOM API directly avoids
// inventing ad hoc JSX.IntrinsicElements typing for an element only this
// component ever touches.
export function EnableBankingAuthFlow({ authorizationId, origin, sandbox, locale = 'EN', onStatusChange, fixtureStatus }: EnableBankingAuthFlowProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Ref, not a dependency: onStatusChange is a fresh closure on every parent
  // render, and re-running this effect on every render would tear down and
  // recreate the widget element for no reason.
  const onStatusChangeRef = useRef(onStatusChange)
  onStatusChangeRef.current = onStatusChange

  useEffect(() => {
    if (fixtureStatus) { onStatusChangeRef.current(fixtureStatus); return }

    const container = containerRef.current
    if (!container) return
    let cancelled = false
    let element: HTMLElement | null = null

    // Enable Banking's `error` event carries a provider-internal payload
    // Finance Planner must never surface verbatim (it could contain
    // upstream/ASPSP detail) and must never log -- only the fact that it
    // fired is used here.
    const handleError = () => { if (!cancelled) onStatusChangeRef.current('error') }
    // `ais-loaded` is the AIS-specific readiness signal; `ready` is the
    // widget's own generic mount signal. Finance Planner is AIS-only here,
    // so either is treated as "stop showing the loading skeleton" --
    // whichever fires first ends the loading state, since both indicate the
    // widget is now interactive.
    const handleReady = () => { if (!cancelled) onStatusChangeRef.current('ready') }

    loadEnableBankingAuthFlowWidget()
      .then(() => {
        if (cancelled || !containerRef.current) return
        element = document.createElement(ENABLE_BANKING_WIDGET_ELEMENT_TAG)
        element.setAttribute('authorization', authorizationId)
        element.setAttribute('origin', origin)
        element.setAttribute('locale', locale)
        if (sandbox) element.setAttribute('sandbox', '')
        element.addEventListener('ready', handleReady)
        element.addEventListener('ais-loaded', handleReady)
        element.addEventListener('error', handleError)
        containerRef.current.appendChild(element)
      })
      .catch(() => { if (!cancelled) onStatusChangeRef.current('error') })

    return () => {
      cancelled = true
      if (element) {
        element.removeEventListener('ready', handleReady)
        element.removeEventListener('ais-loaded', handleReady)
        element.removeEventListener('error', handleError)
        element.remove()
      }
    }
  }, [authorizationId, origin, sandbox, locale, fixtureStatus])

  return <div className="connections-auth-flow-widget" ref={containerRef} data-fixture-status={fixtureStatus}/>
}
