import type { ComponentProps } from 'react'
import { ConnectionsPage } from './features/connections/ConnectionsPage'
import type { ConnectionsAcceptanceMode } from './features/connections/connectionsAcceptanceFixtures'

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
]

type ConnectionsPanelProps = ComponentProps<typeof ConnectionsPage>

export function ConnectionsPanel(props: ConnectionsPanelProps) {
  let acceptanceMode = props.acceptanceMode

  if (import.meta.env.VITE_ACCEPTANCE_FIXTURES === 'true' && typeof window !== 'undefined') {
    const requestedMode = new URLSearchParams(window.location.search).get('connectionsAcceptanceMode')
    if (CONNECTIONS_ACCEPTANCE_MODES.includes(requestedMode as ConnectionsAcceptanceMode)) {
      acceptanceMode = requestedMode as ConnectionsAcceptanceMode
    }
  }

  return <ConnectionsPage {...props} acceptanceMode={acceptanceMode}/>
}
