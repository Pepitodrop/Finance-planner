import { useState } from 'react'
import { startRegistration } from '@simplewebauthn/browser'

export function TestEnrollmentPage() {
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const token = new URLSearchParams(window.location.search).get('token') || ''

  const enroll = async () => {
    if (!token) {
      setStatus('error')
      setMessage('Der Einladungslink enthält kein Token.')
      return
    }
    setStatus('working')
    setMessage('')
    try {
      const optionsResponse = await fetch(`/api/auth/test-enrollment/options?token=${encodeURIComponent(token)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      if (!optionsResponse.ok) throw new Error((await optionsResponse.json().catch(() => null))?.error || 'Einladungslink ist ungültig oder abgelaufen.')
      const credential = await startRegistration({ optionsJSON: await optionsResponse.json() })
      const verifyResponse = await fetch('/api/auth/test-enrollment/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ token, credential }),
      })
      if (!verifyResponse.ok) throw new Error((await verifyResponse.json().catch(() => null))?.error || 'Passkey konnte nicht eingerichtet werden.')
      setStatus('done')
      setMessage('Der Testzugang wurde eingerichtet. Du wirst zur App weitergeleitet.')
      window.setTimeout(() => window.location.assign('/'), 800)
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Passkey konnte nicht eingerichtet werden.')
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="test-enrollment-title">
        <p className="eyebrow">Einmalige Testkonto-Einrichtung</p>
        <h1 id="test-enrollment-title">Testzugang mit Passkey aktivieren</h1>
        <p>Dieser Link kann nur einmal und nur für kurze Zeit verwendet werden. Richte jetzt einen Geräte-Passkey ein.</p>
        {message && <p role={status === 'error' ? 'alert' : 'status'}>{message}</p>}
        <button type="button" className="primary" onClick={() => void enroll()} disabled={status === 'working' || status === 'done'}>
          {status === 'working' ? 'Passkey wird eingerichtet …' : status === 'done' ? 'Eingerichtet' : 'Passkey einrichten'}
        </button>
      </section>
    </main>
  )
}
