import { useState } from 'react'
import { LogOut } from 'lucide-react'
import type { AuthUser } from './AuthGate'

interface AccountPageProps {
  user: AuthUser
  onLogout: () => Promise<void>
  onNavigateToData: () => void
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase()
}

// ACCOUNT-01: session identity and sign-out only. Deliberately has no
// profile editor -- Finance Planner has no backend capability to change
// name or email (both come from the Google account or the fixed
// test-account record), so inventing editable fields here would silently
// do nothing.
export function AccountPage({ user, onLogout, onNavigateToData }: AccountPageProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const signOut = async () => {
    setBusy(true)
    setError('')
    try {
      await onLogout()
    } catch {
      // Network failure only -- do not clear any local app state, the
      // session cookie may still be valid.
      setError("Couldn't sign out. Check your connection and try again.")
      setBusy(false)
    }
  }

  return <div className="account-page" lang="en" data-account-ready="true">
    <section className="panel account-identity-panel">
      <p className="eyebrow">Signed in as</p>
      <div className="account-identity-row">
        <div className="account-avatar" aria-hidden="true">
          {user.picture ? <img src={user.picture} alt=""/> : <span>{initials(user.name)}</span>}
        </div>
        <div>
          <p className="account-name">{user.name}</p>
          <p className="account-email muted">{user.email}</p>
        </div>
      </div>
      <p className="account-note muted">Signing in confirms who you are. It's separate from your encrypted vault, which stays locked until you unlock it on each device.</p>
    </section>

    <section className="panel account-security-panel">
      <p className="eyebrow">Security</p>
      <p>{user.passkeyCount > 0 ? `${user.passkeyCount} passkey${user.passkeyCount === 1 ? '' : 's'} registered for sign-in.` : 'No passkeys registered yet.'}</p>
      <button type="button" className="data-tools-link" onClick={onNavigateToData}>Manage vault security in Data &amp; Backup →</button>
    </section>

    <section className="panel account-signout-panel">
      <p className="eyebrow">Session</p>
      <h2>Sign out of Finance Planner on this device</h2>
      <p className="muted">You'll need to sign in again to continue. Your encrypted data stays safely on this device either way.</p>
      <button type="button" className="secondary" disabled={busy} onClick={() => void signOut()}>
        <LogOut size={18}/> {busy ? 'Signing out…' : 'Sign out'}
      </button>
      {error && <p className="status-message error-message" role="alert">{error}</p>}
    </section>
  </div>
}
