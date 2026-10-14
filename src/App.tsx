import { useEffect, useState, type ReactNode } from 'react'
import {
  ChevronDown, LogOut, Moon, Search, Shield, Sun,
} from 'lucide-react'
import { signOut } from 'firebase/auth'
import { auth } from './firebase'
import { canManageRaidData, canManageRoster, guildRoles, type GuildRole } from './security'
import { useGuildData } from './useGuildData'
import { useGuildSession } from './useGuildSession'
import { AccessScreen } from './AccessScreen'
import {
  guildCrest, membersArt, lootArt, trophyArt, seasonArt, guildArt,
} from './shared/art'
import { type RaidView } from './shared/game/teams'
import { ArtIcon } from './shared/ui/ArtIcon'
import type { ModalRenderer, TabContext } from './shared/tabs/types'
import { ModalHost, type ActiveModal } from './shell/ModalHost'
import { DEFAULT_TAB_ID, FALLBACK_TAB_ID, isTabVisible, tabList, type TabId } from './shell/tabs'
import './App.css'

function App() {
  const session = useGuildSession()
  const actualRole = session.membership?.role ?? null
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('intrepid-theme') === 'dark' ? 'dark' : 'light')
  const [selectedTab, setActiveTab] = useState<TabId>(DEFAULT_TAB_ID)
  const [raidView, setRaidView] = useState<RaidView>(10)
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<ActiveModal | null>(null)
  const [impersonatedRole, setImpersonatedRole] = useState<GuildRole | null>(null)
  const [mutationError, setMutationError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const data = useGuildData(session.status === 'active', actualRole)
  const { roster, priorities, awards, dataError } = data
  const effectiveRole = actualRole === 'Guild Leader' ? impersonatedRole ?? actualRole : actualRole
  const selectedDef = tabList.find((entry) => entry.id === selectedTab) ?? tabList[0]
  const tab = isTabVisible(selectedDef, effectiveRole) ? selectedDef : tabList.find((entry) => entry.id === FALLBACK_TAB_ID) ?? tabList[0]
  const canEditRoster = effectiveRole ? canManageRoster(effectiveRole) : false
  const canEditRaidData = effectiveRole ? canManageRaidData(effectiveRole) : false

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('intrepid-theme', theme)
  }, [theme])

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        document.getElementById('table-search')?.focus()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  function openModal(render: ModalRenderer) {
    setModal((current) => ({ render, key: (current?.key ?? 0) + 1 }))
  }

  function navigate(id: string) {
    const target = tabList.find((entry) => entry.id === id)
    if (target) setActiveTab(target.id)
    else if (import.meta.env.DEV) console.warn(`navigate: unknown tab id "${id}"`)
  }

  if (session.status !== 'active' || !session.membership) {
    return <AccessScreen status={session.status} user={session.user} error={session.error} setError={session.setError} theme={theme} onToggleTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />
  }

  const ctx: TabContext = {
    data,
    query,
    identity: { uid: session.user?.uid ?? '', displayName: session.membership.displayName, canEditRoster, canEditRaidData },
    shell: { raidView, setRaidView },
    feedback: { busy, setBusy, setMutationError, setNotice },
    openModal,
    navigate,
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="Intrepid raid desk home"><span className="brand-mark"><img src={guildCrest} alt="" /></span><span className="brand-copy"><strong>INTREPID</strong><small>RAID DESK</small></span></a>
        <div className="guild-switcher"><span className="guild-emblem"><ArtIcon src={guildArt} className="guild-emblem-art" /></span><span className="guild-name"><strong>Intrepid</strong><small>Guild workspace</small></span><ChevronDown size={15} /></div>
        <div className="side-label">GUILD TOOLS</div>
        <nav className="main-nav" aria-label="Guild tools">
          {tabList.map((entry) => isTabVisible(entry, effectiveRole) && <NavButton key={entry.id} active={tab.id === entry.id} onClick={() => { setActiveTab(entry.id); setQuery('') }} icon={<ArtIcon src={entry.art} className="nav-art-icon" />} label={entry.label} count={entry.navCount ? entry.navCount(ctx) : 0} />)}
        </nav>
        <div className="sidebar-bottom"><div className="season-card"><span className="season-icon"><ArtIcon src={seasonArt} className="season-art-icon" /></span><span><small>SEASON</small><strong>Launch prep</strong></span><span className="season-dot" /></div><span className="version-label">SECURE WORKSPACE · 0.2.0</span></div>
      </aside>

      <main className="main-content" id="top">
        <header className="topbar"><div className="breadcrumb"><span>INTREPID</span><span className="crumb-slash">/</span><strong>{tab.label.toUpperCase()}</strong></div><div className="topbar-actions">
          {actualRole === 'Guild Leader' && <label className="impersonation-control"><span>VIEW AS</span><select value={effectiveRole ?? 'Guild Leader'} onChange={(event) => setImpersonatedRole(event.target.value === 'Guild Leader' ? null : event.target.value as GuildRole)}>{guildRoles.map((role) => <option key={role}>{role}</option>)}</select></label>}
          {impersonatedRole && <span className="impersonation-badge">Previewing {impersonatedRole}</span>}
          <span className="role-badge">{effectiveRole}</span><span className="avatar" title={session.user?.email ?? ''}>{session.membership.displayName.slice(0, 2).toUpperCase()}</span>
          <button className="icon-button theme-toggle" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-pressed={theme === 'dark'} onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
          <button className="icon-button" title="Sign out" aria-label="Sign out" onClick={() => auth && void signOut(auth)}><LogOut size={16} /></button>
        </div></header>
        <div className="page-wrap">
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> GUILD OPERATIONS</div><h1>{tab.label}</h1><p>{tab.hint}</p></div><div className="heading-actions">
            {tab.HeadingActions && <tab.HeadingActions ctx={ctx} />}
          </div></section>

          <section className="stat-strip" aria-label="Guild overview">
            <Stat icon={<ArtIcon src={membersArt} className="stat-art-icon" />} tone="green" label="ROSTER" value={roster.length} detail="members" />
            <Stat icon={<ArtIcon src={lootArt} className="stat-art-icon" />} tone="orange" label="PRIORITY LIST" value={priorities.length} detail="items tracked" />
            <Stat icon={<ArtIcon src={trophyArt} className="stat-art-icon" />} tone="dark" label="AWARDED" value={awards.length} detail="decisions logged" />
            <div className="stat-callout"><span className="pulse-dot" /> COUNCIL STATUS <strong>Preparing for launch</strong></div>
          </section>

          <section className="workspace-panel">
            <div className="panel-toolbar"><div className="panel-heading"><h2>{tab.panelTitle}</h2><span className="record-count">{tab.recordCount(ctx)}</span></div><div className="toolbar-controls">
              {tab.Toolbar && <tab.Toolbar ctx={ctx} />}
              {tab.search && <label className="search-field" htmlFor="table-search"><Search size={15} /><input id="table-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab.search.placeholder} /><kbd>Ctrl K</kbd></label>}
            </div></div>
            <tab.Content key={tab.id} ctx={ctx} />
            {(mutationError || dataError) && <p className="app-error" role="alert">{mutationError || dataError}</p>}
            {notice && <p className="app-notice" role="status">{notice}</p>}
            <footer className="panel-footer"><span>{tab.footer(ctx)}</span><span className="footer-right"><span className="save-indicator" /> Shared with guild</span></footer>
          </section>
          <p className="preview-note"><Shield size={14} /> Guild data is shared with authorized guild accounts and protected by Firestore rules.</p>
        </div>
      </main>

      <ModalHost modal={modal} close={() => setModal(null)} live={ctx} />
    </div>
  )
}

function NavButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; count: number }) {
  return <button className={active ? 'nav-item active' : 'nav-item'} onClick={onClick}>{icon}<span>{label}</span><span className="nav-count">{count}</span></button>
}

function Stat({ icon, tone, label, value, detail }: { icon: ReactNode; tone: string; label: string; value: number; detail: string }) {
  return <div className="stat-cell"><span className={`stat-icon ${tone}`}>{icon}</span><span className="stat-label">{label}</span><strong>{value}<small> {detail}</small></strong></div>
}

export default App
