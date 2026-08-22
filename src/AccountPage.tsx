import { useState } from 'react'
import { LogOut } from 'lucide-react'
import type { AuthUser } from './AuthGate'
import { clearUnlockedState, flushCloudState } from './storage'
import { lockVault } from './vault'

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
      // Flush any queued encrypted cloud write while the authenticated
      // session still exists. This never exposes the vault password or key.
      await flushCloudState()

      // The server revokes the user's authenticated sessions and expires the
      // current fp_session cookie. Only after that succeeds do we discard the
      // decrypted client state on this device.
      await onLogout()
      clearUnlockedState()
      lockVault()
    } catch {
      // If server sign-out fails, keep the unlocked state intact: the cookie
      // may still be valid and the UI must not pretend that logout succeeded.
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
      <h2>Fully sign out of Finance Planner</h2>
      <p className="muted">Your Finance Planner sessions are revoked, so other signed-in devices will need to sign in again. On this device the decrypted vault is removed from memory, while the encrypted vault remains available for your next sign-in.</p>
      <button type="button" className="secondary" disabled={busy} onClick={() => void signOut()}>
        <LogOut size={18}/> {busy ? 'Signing out…' : 'Sign out completely'}
      </button>
      {error && <p className="status-message error-message" role="alert">{error}</p>}
    </section>
  </div>
}
