import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthGate } from './AuthGate'
import { ErrorBoundary } from './ErrorBoundary'
import { MobileRuntime } from './MobileRuntime'
import { VaultGate } from './VaultGate'
import './styles.css'
import './ai.css'
import './assistant.css'
import './usability.css'
import './connectors.css'
import './mobile.css'
import './mobile-production.css'
import './auth.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <MobileRuntime />
      <AuthGate><VaultGate><App /></VaultGate></AuthGate>
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
