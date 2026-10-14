import { signOut } from 'firebase/auth'
import { LogOut, Moon, Sun } from 'lucide-react'
import { auth } from '../firebase'
import { guildRoles, type GuildRole } from '../security'

// Role display and VIEW AS live in the shell only (App.tsx, Topbar, Sidebar). VIEW AS changes what
// the UI shows; it never changes the authenticated identity or what Firestore allows.
export function Topbar({ title, actualRole, effectiveRole, impersonatedRole, onImpersonate, email, displayName, theme, onToggleTheme }: {
  title: string
  actualRole: GuildRole | null
  effectiveRole: GuildRole | null
  impersonatedRole: GuildRole | null
  onImpersonate: (role: GuildRole | null) => void
  email: string
  displayName: string
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}) {
  return (
    <header className="topbar"><div className="breadcrumb"><span>INTREPID</span><span className="crumb-slash">/</span><strong>{title.toUpperCase()}</strong></div><div className="topbar-actions">
      {actualRole === 'Guild Leader' && <label className="impersonation-control"><span>VIEW AS</span><select value={effectiveRole ?? 'Guild Leader'} onChange={(event) => onImpersonate(event.target.value === 'Guild Leader' ? null : event.target.value as GuildRole)}>{guildRoles.map((role) => <option key={role}>{role}</option>)}</select></label>}
      {impersonatedRole && <span className="impersonation-badge">Previewing {impersonatedRole}</span>}
      <span className="role-badge">{effectiveRole}</span><span className="avatar" title={email}>{displayName.slice(0, 2).toUpperCase()}</span>
      <button className="icon-button theme-toggle" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-pressed={theme === 'dark'} onClick={onToggleTheme}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
      <button className="icon-button" title="Sign out" aria-label="Sign out" onClick={() => auth && void signOut(auth)}><LogOut size={16} /></button>
    </div></header>
  )
}
