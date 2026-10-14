import { useState, type FormEvent } from 'react'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { AlertCircle, Check, Moon, Sun } from 'lucide-react'
import { auth, firebaseConfigured, guildId } from './firebase'
import { submitJoinRequest } from './guildApi'
import type { GuildSessionStatus } from './useGuildSession'
import guildCrest from '../Art/GuildCrest-256.png'
import shieldArt from '../Art/icons-split/shield.png'
import './AccessScreen.css'

export function AccessScreen({ status, user, error, setError, offline, onRetry, theme, onToggleTheme }: {
  status: GuildSessionStatus
  user: { uid: string; email: string | null } | null
  error: string
  setError: (error: string) => void
  offline?: boolean
  onRetry?: () => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}) {
  const [authMode, setAuthMode] = useState<'sign-in' | 'create'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!auth) return
    setBusy(true)
    setError('')
    try {
      if (authMode === 'create') await createUserWithEmailAndPassword(auth, email.trim(), password)
      else await signInWithEmailAndPassword(auth, email.trim(), password)
      setPassword('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  async function requestAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return
    setBusy(true)
    setError('')
    try {
      await submitJoinRequest(user.uid, user.email ?? email, displayName.trim())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit your request.')
    } finally {
      setBusy(false)
    }
  }

  async function leaveAccount() {
    setAuthMode('sign-in')
    setEmail('')
    setPassword('')
    setDisplayName('')
    if (auth) await signOut(auth)
  }

  return <main className="access-shell">
    <header className="access-brand"><span className="access-brand-mark"><img src={guildCrest} alt="" /></span><span><strong>INTREPID</strong><small>GUILD RAID DESK</small></span><button className="icon-button access-theme-toggle" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-pressed={theme === 'dark'} onClick={onToggleTheme}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button></header>
    <section className="access-panel">
      <div className="access-emblem"><img src={shieldArt} alt="" /></div>
      {!firebaseConfigured || status === 'unconfigured' ? <>
        <span className="access-kicker">SETUP REQUIRED</span><h1>Connect your guild space</h1>
        <p>Authentication and shared guild data are not configured yet. Add the Firebase web-app settings and guild ID to your local environment, then deploy the Firestore rules.</p>
        <code>.env.local</code>
      </> : status === 'loading' ? <>
        <span className="access-kicker">CHECKING ACCESS</span><h1>Connecting to the guild</h1><p>{offline ? 'You appear to be offline, or the guild database cannot be reached. This page continues when the connection returns.' : 'Verifying your sign-in and guild membership.'}</p>{offline && <button className="access-switch" onClick={leaveAccount}>Sign out</button>}
      </> : status === 'signed-out' ? <>
        <span className="access-kicker">GUILD ACCESS</span><h1>{authMode === 'create' ? 'Create an account' : 'Sign in'}</h1>
        <p>Use your account to access the shared guild roster and loot council.</p>
        <form className="access-form" onSubmit={authenticate}>
          {authMode === 'create' && <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required /></label>}
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={authMode === 'create' ? 'new-password' : 'current-password'} minLength={6} required /></label>
          <button className="access-submit" disabled={busy}>{busy ? 'Working...' : authMode === 'create' ? 'Create account' : 'Sign in'}</button>
        </form>
        <button className="access-switch" onClick={() => { setAuthMode(authMode === 'create' ? 'sign-in' : 'create'); setError('') }}>{authMode === 'create' ? 'Already have an account? Sign in' : 'New to the guild desk? Create an account'}</button>
      </> : status === 'pending' ? <>
        <span className="access-kicker">REQUEST SENT</span><h1>Waiting for guild approval</h1><p>A Guild Leader will review your request. You can sign out while it is pending.</p><button className="access-submit secondary" onClick={leaveAccount}>Sign out</button>
      </> : status === 'error' ? <>
        <span className="access-kicker">ACCESS CHECK FAILED</span><h1>Could not verify access</h1><p>{error || 'Check the Firebase project settings and security rules.'}</p><p>Guild ID: {guildId}</p>{onRetry && <button className="access-submit secondary" onClick={onRetry}>Try again</button>}<button className="access-switch" onClick={leaveAccount}>Sign out</button>
      </> : <>
        <span className="access-kicker">{status === 'rejected' ? 'REQUEST DECLINED' : 'GUILD ACCESS'}</span><h1>Request guild access</h1>
        <p>{status === 'rejected' ? 'You can submit a new request for Guild Leader review.' : `Signed in as ${user?.email ?? 'your account'}. Tell the Guild Leaders what name to look for.`}</p>
        <form className="access-form" onSubmit={requestAccess}><label>Character or display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required /></label><button className="access-submit" disabled={busy}><Check size={16} /> {busy ? 'Sending...' : 'Request access'}</button></form>
        <button className="access-switch" onClick={leaveAccount}>Sign out</button>
      </>}
      {error && status !== 'error' && <p className="access-error"><AlertCircle size={14} />{error}</p>}
    </section>
    <p className="access-footnote">Guild membership and permissions are enforced by Firebase security rules.</p>
  </main>
}
