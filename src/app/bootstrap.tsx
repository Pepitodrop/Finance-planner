import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '../App'
import { AuthGate } from '../AuthGate'
import { AutomaticTransactionAnalysis } from '../AutomaticTransactionAnalysis'
import { ErrorBoundary } from '../ErrorBoundary'
import { FrontendExperience } from '../FrontendExperience'
import { MobileConnectivityStatus } from '../MobileConnectivityStatus'
import { MobileEnhancements } from '../MobileEnhancements'
import { MobileExperience } from '../MobileExperience'
import { MobileProductionRuntime } from '../MobileProductionRuntime'
import { MobileRuntime } from '../MobileRuntime'
import { NavigationAccessibility } from '../NavigationAccessibility'
import { TestEnrollmentPage } from '../TestEnrollmentPage'
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
import '../automatic-analysis.css'
import '../production-readiness.css'
import '../auth.css'
import '../features/sync/cloud-sync.css'
import '../reference-dashboard.css'
import '../reference-dashboard-fidelity.css'
import '../transactions-reference.css'
import '../remaining-pages-redesign.css'
import '../reference-page-compositions.css'

const enrollmentRoute = window.location.pathname === '/test-enrollment'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {enrollmentRoute ? <TestEnrollmentPage /> : <>
        <WebMobileHardening />
        <FrontendExperience />
        <NavigationAccessibility />
        <MobileProductionRuntime />
        <MobileRuntime />
        <MobileConnectivityStatus />
        <MobileEnhancements />
        <MobileExperience />
        <AuthGate>{(user) => <VaultGate key={user.id} userId={user.id}><><App userId={user.id} userName={user.name} /><CloudSyncStatus /><AutomaticTransactionAnalysis /></></VaultGate>}</AuthGate>
      </>}
    </ErrorBoundary>
  </React.StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return
      refreshing = true
      window.location.reload()
    })

    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registration) => {
      const announceUpdate = (worker: ServiceWorker | null) => {
        if (!worker || !navigator.serviceWorker.controller) return
        window.dispatchEvent(new CustomEvent('finance-planner:update-available', { detail: { registration } }))
      }
      announceUpdate(registration.waiting)
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') announceUpdate(worker)
        })
      })
      void registration.update()
      window.setInterval(() => void registration.update(), 60 * 60 * 1000)
    }).catch((error: unknown) => {
      console.warn('Service worker registration failed', error)
    })
  })
}
