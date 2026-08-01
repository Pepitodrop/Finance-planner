import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '../App'
import { AuthGate } from '../AuthGate'
import { ErrorBoundary } from '../ErrorBoundary'
import { FrontendExperience } from '../FrontendExperience'
import { MobileConnectivityStatus } from '../MobileConnectivityStatus'
import { MobileEnhancements } from '../MobileEnhancements'
import { MobileExperience } from '../MobileExperience'
import { MobileProductionRuntime } from '../MobileProductionRuntime'
import { MobileRuntime } from '../MobileRuntime'
import { VaultGate } from '../VaultGate'
import { WebMobileHardening } from '../WebMobileHardening'
import { CloudSyncStatus } from '../features/sync/CloudSyncStatus'
import '../styles.css'
import '../ai.css'
import '../assistant.css'
import '../receipt.css'
import '../budget-learning.css'
import '../usability.css'
import '../connectors.css'
import '../mobile.css'
import '../mobile-connectivity.css'
import '../mobile-enhancements.css'
import '../mobile-experience.css'
import '../web-mobile-hardening.css'
import '../frontend-experience.css'
import '../production-readiness.css'
import '../auth.css'
import '../features/sync/cloud-sync.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <WebMobileHardening />
      <FrontendExperience />
      <MobileProductionRuntime />
      <MobileRuntime />
      <MobileConnectivityStatus />
      <MobileEnhancements />
      <MobileExperience />
      <AuthGate>{(user) => <VaultGate key={user.id} userId={user.id}><><App userId={user.id} /><CloudSyncStatus /></></VaultGate>}</AuthGate>
    </ErrorBoundary>
  </React.StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registration) => {
      void registration.update()
    }).catch((error: unknown) => {
      console.warn('Service worker registration failed', error)
    })
  })
}
