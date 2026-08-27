import { useEffect, useState, type ComponentProps } from 'react'
import { ConnectionsPage } from './features/connections/ConnectionsPage'
import type { ConnectionsAcceptanceMode } from './features/connections/connectionsAcceptanceFixtures'
import {
  acceptConnectorReturnSignal,
  subscribeConnectorReturns,
  takeBufferedConnectorReturn,
  type ConnectorReturnSignal,
} from './providerReturnBridge'

const CONNECTIONS_ACCEPTANCE_MODES: ConnectionsAcceptanceMode[] = [
  'empty',
  'populated',
  'institution-selector',
  'institution-search',
  'account-type',
  'bank-confirmation',
  'paypal-confirmation',
  'checking',
  'sync-selection',
  'attention',
  'manual',
  'statement-preview',
  'enablebanking-auth-flow-loading',
  'enablebanking-auth-flow-error',
]

const ACCEPTANCE_MODE_STORAGE_KEY = 'finance-planner-connections-acceptance-mode'
type ConnectionsPanelProps = ComponentProps<typeof ConnectionsPage>

export function ConnectionsPanel(props: ConnectionsPanelProps) {
  let acceptanceMode = props.acceptanceMode
  const [providerReturnGeneration, setProviderReturnGeneration] = useState(0)

  if (import.meta.env.VITE_ACCEPTANCE_FIXTURES === 'true' && typeof window !== 'undefined') {
    const queryMode = new URLSearchParams(window.location.search).get('connectionsAcceptanceMode')
    const requestedMode = queryMode || window.localStorage.getItem(ACCEPTANCE_MODE_STORAGE_KEY)
    if (CONNECTIONS_ACCEPTANCE_MODES.includes(requestedMode as ConnectionsAcceptanceMode)) {
      acceptanceMode = requestedMode as ConnectionsAcceptanceMode
    }
  }

  useEffect(() => {
    const applyAcceptedReturn = (signal: ConnectorReturnSignal) => {
      const url = new URL(window.location.href)
      for (const key of ['code', 'state', 'scope', 'error', 'error_description', 'provider', 'institution']) url.searchParams.delete(key)
      if (signal.provider) url.searchParams.set('provider', signal.provider)
      if (signal.error) url.searchParams.set('error', signal.error)
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
      // ConnectionsPage already owns callback-result UX and synchronization.
      // Remounting only that page reuses the existing, tested callback path
      // without reloading App/VaultGate, so the in-memory vault stays open.
      setProviderReturnGeneration((generation) => generation + 1)
    }

    const buffered = takeBufferedConnectorReturn()
    if (buffered) applyAcceptedReturn(buffered)

    return subscribeConnectorReturns((signal) => {
      const accepted = acceptConnectorReturnSignal(signal)
      if (accepted) applyAcceptedReturn(accepted)
    })
  }, [])

  return <ConnectionsPage
    key={`${acceptanceMode ?? 'live'}:${providerReturnGeneration}`}
    {...props}
    acceptanceMode={acceptanceMode}
  />
}
