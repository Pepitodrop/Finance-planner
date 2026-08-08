import { useState } from 'react'
import { startRegistration } from '@simplewebauthn/browser'

export function TestEnrollmentPage() {
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const token = new URLSearchParams(window.location.search).get('token') || ''

  const enroll = async () => {
    if (!token) {
      setStatus('error')
      setMessage('The invitation link is missing a token.')
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
      if (!optionsResponse.ok) throw new Error((await optionsResponse.json().catch(() => null))?.error || 'The invitation link is invalid or has expired.')
      const credential = await startRegistration({ optionsJSON: await optionsResponse.json() })
      const verifyResponse = await fetch('/api/auth/test-enrollment/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ token, credential }),
      })
      if (!verifyResponse.ok) throw new Error((await verifyResponse.json().catch(() => null))?.error || 'The passkey could not be set up.')
      setStatus('done')
      setMessage('Test access is set up. You will be redirected to the app.')
      window.setTimeout(() => window.location.assign('/'), 800)
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'The passkey could not be set up.')
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="test-enrollment-title">
        <p className="eyebrow">One-time test account setup</p>
        <h1 id="test-enrollment-title">Activate test access with a passkey</h1>
        <p>This link can only be used once and only for a short time. Set up a device passkey now.</p>
        {message && <p role={status === 'error' ? 'alert' : 'status'}>{message}</p>}
        <button type="button" className="primary" onClick={() => void enroll()} disabled={status === 'working' || status === 'done'}>
          {status === 'working' ? 'Setting up passkey…' : status === 'done' ? 'Set up' : 'Set up passkey'}
        </button>
      </section>
    </main>
  )
}
