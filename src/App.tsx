import { useEffect, useState, type ReactNode } from 'react'
import {
  ChevronDown, LogOut, Moon, Plus, Search, Shield, Sun,
} from 'lucide-react'
import { signOut } from 'firebase/auth'
import {
  createAfkEntry, deleteAfkEntry, approveJoinRequest,
  importLocalPreviewData, rejectJoinRequest, saveGuildRecord,
  updateMembershipAccess, type JoinRequestRecord, type PriorityRecord,
} from './guildApi'
import { auth } from './firebase'
import { canManageRaidData, canManageRoster, guildRoles, type GuildRole } from './security'
import { useGuildData } from './useGuildData'
import { useGuildSession } from './useGuildSession'
import { AccessScreen } from './AccessScreen'
import { AfkCalendar } from './features/calendar/AfkCalendar'
import {
  guildCrest, membersArt, raidArt, lootArt, trophyArt, accessArt,
  seasonArt, calendarArt, guildArt,
} from './shared/art'
import { type RaidView } from './shared/game/teams'
import { localDateKey } from './shared/lib/dates'
import { ArtIcon } from './shared/ui/ArtIcon'
import type { ModalRenderer, TabContext } from './shared/tabs/types'
import { ModalHost, type ActiveModal } from './shell/ModalHost'
import { PlayerModal } from './features/roster/PlayerModal'
import { RaidModal } from './features/calendar/RaidModal'
import { AwardModal } from './features/loot/AwardModal'
import { PriorityModal } from './features/loot/PriorityModal'
import { filterRoster } from './features/roster/filter'
import { RosterTab } from './features/roster/RosterTab'
import { TeamsTab } from './features/teams/TeamsTab'
import { AwardHistory } from './features/loot/AwardHistory'
import { PriorityList } from './features/loot/PriorityList'
import { GuildAccessManager } from './features/access/GuildAccessManager'
import './App.css'

type Tab = 'roster' | 'teams' | 'afk' | 'priorities' | 'history' | 'access'
type LootPriority = PriorityRecord

function App() {
  const session = useGuildSession()
  const actualRole = session.membership?.role ?? null
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('intrepid-theme') === 'dark' ? 'dark' : 'light')
  const [selectedTab, setActiveTab] = useState<Tab>('priorities')
  const [raidView, setRaidView] = useState<RaidView>(10)
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<ActiveModal | null>(null)
  const [impersonatedRole, setImpersonatedRole] = useState<GuildRole | null>(null)
  const [mutationError, setMutationError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const data = useGuildData(session.status === 'active', actualRole)
  const { roster, assignments, priorities, awards, afkEntries, raids, members, joinRequests, dataError } = data
  const effectiveRole = actualRole === 'Guild Leader' ? impersonatedRole ?? actualRole : actualRole
  const activeTab = selectedTab === 'access' && effectiveRole !== 'Guild Leader' ? 'roster' : selectedTab
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
  const filteredRoster = filterRoster(roster, query)
  const assignedCount = roster.filter((player) => assignments[player.id]).length
  const filteredPriorities = priorities.filter((priority) => `${priority.item} ${priority.encounter} ${priority.rankedPlayers.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const filteredAwards = awards.filter((award) => `${award.item} ${award.encounter} ${award.recipient}`.toLowerCase().includes(query.toLowerCase()))

  function openModal(render: ModalRenderer) {
    setModal((current) => ({ render, key: (current?.key ?? 0) + 1 }))
  }

  function navigate(id: string) {
    if ((['roster', 'teams', 'afk', 'priorities', 'history', 'access'] as string[]).includes(id)) setActiveTab(id as Tab)
  }

  function openAward(priority: LootPriority) {
    const now = new Date()
    const localDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
    openModal(({ close, live }) => <AwardModal priority={priority} awardedAt={localDate} close={close} live={live} />)
  }

  async function moveCandidate(priority: LootPriority, index: number, direction: -1 | 1) {
    const rankedPlayers = [...priority.rankedPlayers]
    const target = index + direction
    if (target < 0 || target >= rankedPlayers.length) return
    ;[rankedPlayers[index], rankedPlayers[target]] = [rankedPlayers[target], rankedPlayers[index]]
    try {
      const { id, ...record } = { ...priority, rankedPlayers }
      await saveGuildRecord('lootPriorities', id, record)
      setMutationError('')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not reorder loot candidates.')
    }
  }

  async function importLegacyData() {
    setBusy(true)
    try {
      const imported = await importLocalPreviewData()
      setMutationError('')
      setNotice(`Imported ${imported} local preview records.`)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not import local preview records.')
    } finally {
      setBusy(false)
    }
  }

  async function changeMemberAccess(uid: string, role: GuildRole, playerId: string | null) {
    if (members.find((member) => member.id === uid)?.role === 'Guild Leader' && role !== 'Guild Leader'
      && members.filter((member) => member.role === 'Guild Leader').length < 2) {
      setMutationError('Promote another Guild Leader before changing the last Guild Leader role.')
      return
    }
    setBusy(true)
    try {
      await updateMembershipAccess(uid, role, playerId)
      setMutationError('')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not update member role.')
    } finally {
      setBusy(false)
    }
  }

  async function approveRequest(request: JoinRequestRecord, role: GuildRole, playerId: string | null) {
    setBusy(true)
    try {
      await approveJoinRequest(request, role, playerId)
      setMutationError('')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not approve join request.')
    } finally {
      setBusy(false)
    }
  }

  async function rejectRequest(uid: string) {
    setBusy(true)
    try {
      await rejectJoinRequest(uid)
      setMutationError('')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not reject join request.')
    } finally {
      setBusy(false)
    }
  }

  async function addAfkEntry(startDate: string, endDate: string) {
    if (!session.user || !session.membership) return false
    setBusy(true)
    try {
      await createAfkEntry({ userId: session.user.uid, displayName: session.membership.displayName, startDate, endDate })
      setMutationError('')
      setNotice('Unavailable dates added.')
      return true
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not add unavailable dates.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function removeAfkEntry(entryId: string) {
    setBusy(true)
    try {
      await deleteAfkEntry(entryId)
      setMutationError('')
      setNotice('Unavailable dates removed.')
      return true
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not remove unavailable dates.')
      return false
    } finally {
      setBusy(false)
    }
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

  const pageTitle = activeTab === 'roster' ? 'Guild roster' : activeTab === 'teams' ? 'Raid teams' : activeTab === 'afk' ? 'Raid Calendar' : activeTab === 'priorities' ? 'Loot priorities' : activeTab === 'history' ? 'Award history' : 'Member access'
  const pageHint = activeTab === 'roster' ? 'Every member of the guild, whether assigned to a raid team or not.' : activeTab === 'teams' ? 'Manage four 10-player groups; larger teams are combined automatically.' : activeTab === 'afk' ? 'Share dates when you are unavailable to raid.' : activeTab === 'priorities' ? 'Set council order before the next drop.' : activeTab === 'history' ? 'A permanent record of council decisions.' : 'Review join requests and manage guild roles.'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="Intrepid raid desk home"><span className="brand-mark"><img src={guildCrest} alt="" /></span><span className="brand-copy"><strong>INTREPID</strong><small>RAID DESK</small></span></a>
        <div className="guild-switcher"><span className="guild-emblem"><ArtIcon src={guildArt} className="guild-emblem-art" /></span><span className="guild-name"><strong>Intrepid</strong><small>Guild workspace</small></span><ChevronDown size={15} /></div>
        <div className="side-label">GUILD TOOLS</div>
        <nav className="main-nav" aria-label="Guild tools">
          <NavButton active={activeTab === 'roster'} onClick={() => { setActiveTab('roster'); setQuery('') }} icon={<ArtIcon src={membersArt} className="nav-art-icon" />} label="Guild roster" count={roster.length} />
          <NavButton active={activeTab === 'teams'} onClick={() => { setActiveTab('teams'); setQuery('') }} icon={<ArtIcon src={raidArt} className="nav-art-icon" />} label="Raid teams" count={assignedCount} />
          <NavButton active={activeTab === 'afk'} onClick={() => { setActiveTab('afk'); setQuery('') }} icon={<ArtIcon src={calendarArt} className="nav-art-icon" />} label="Raid Calendar" count={raids.length + afkEntries.length} />
          <NavButton active={activeTab === 'priorities'} onClick={() => { setActiveTab('priorities'); setQuery('') }} icon={<ArtIcon src={lootArt} className="nav-art-icon" />} label="Loot priorities" count={priorities.length} />
          <NavButton active={activeTab === 'history'} onClick={() => { setActiveTab('history'); setQuery('') }} icon={<ArtIcon src={trophyArt} className="nav-art-icon" />} label="Award history" count={awards.length} />
          {effectiveRole === 'Guild Leader' && <NavButton active={activeTab === 'access'} onClick={() => { setActiveTab('access'); setQuery('') }} icon={<ArtIcon src={accessArt} className="nav-art-icon" />} label="Member access" count={joinRequests.length} />}
        </nav>
        <div className="sidebar-bottom"><div className="season-card"><span className="season-icon"><ArtIcon src={seasonArt} className="season-art-icon" /></span><span><small>SEASON</small><strong>Launch prep</strong></span><span className="season-dot" /></div><span className="version-label">SECURE WORKSPACE · 0.2.0</span></div>
      </aside>

      <main className="main-content" id="top">
        <header className="topbar"><div className="breadcrumb"><span>INTREPID</span><span className="crumb-slash">/</span><strong>{pageTitle.toUpperCase()}</strong></div><div className="topbar-actions">
          {actualRole === 'Guild Leader' && <label className="impersonation-control"><span>VIEW AS</span><select value={effectiveRole ?? 'Guild Leader'} onChange={(event) => setImpersonatedRole(event.target.value === 'Guild Leader' ? null : event.target.value as GuildRole)}>{guildRoles.map((role) => <option key={role}>{role}</option>)}</select></label>}
          {impersonatedRole && <span className="impersonation-badge">Previewing {impersonatedRole}</span>}
          <span className="role-badge">{effectiveRole}</span><span className="avatar" title={session.user?.email ?? ''}>{session.membership.displayName.slice(0, 2).toUpperCase()}</span>
          <button className="icon-button theme-toggle" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-pressed={theme === 'dark'} onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
          <button className="icon-button" title="Sign out" aria-label="Sign out" onClick={() => auth && void signOut(auth)}><LogOut size={16} /></button>
        </div></header>
        <div className="page-wrap">
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> GUILD OPERATIONS</div><h1>{pageTitle}</h1><p>{pageHint}</p></div><div className="heading-actions">
            {activeTab === 'roster' && canEditRoster && <button className="button button-primary" onClick={() => openModal(({ close, live }) => <PlayerModal close={close} live={live} />)}><Plus size={16} /> Add member</button>}
            {activeTab === 'afk' && canEditRaidData && <button className="button button-primary" onClick={() => openModal(({ close, live }) => <RaidModal date={localDateKey(new Date())} close={close} live={live} />)}><Plus size={16} /> Add Raid</button>}
            {activeTab === 'priorities' && canEditRaidData && <button className="button button-primary" onClick={() => openModal(({ close, live }) => <PriorityModal close={close} live={live} />)}><Plus size={16} /> Add priority</button>}
          </div></section>

          <section className="stat-strip" aria-label="Guild overview">
            <Stat icon={<ArtIcon src={membersArt} className="stat-art-icon" />} tone="green" label="ROSTER" value={roster.length} detail="members" />
            <Stat icon={<ArtIcon src={lootArt} className="stat-art-icon" />} tone="orange" label="PRIORITY LIST" value={priorities.length} detail="items tracked" />
            <Stat icon={<ArtIcon src={trophyArt} className="stat-art-icon" />} tone="dark" label="AWARDED" value={awards.length} detail="decisions logged" />
            <div className="stat-callout"><span className="pulse-dot" /> COUNCIL STATUS <strong>Preparing for launch</strong></div>
          </section>

          <section className="workspace-panel">
            <div className="panel-toolbar"><div className="panel-heading"><h2>{activeTab === 'roster' ? 'Guild roster' : activeTab === 'teams' ? 'Team composition' : activeTab === 'afk' ? 'Raid Calendar' : activeTab === 'priorities' ? 'Upcoming loot' : activeTab === 'history' ? 'Recent awards' : 'Guild members and requests'}</h2><span className="record-count">{activeTab === 'roster' ? `${roster.length} members` : activeTab === 'teams' ? (raidView === 10 ? '4 teams' : raidView === 20 ? '2 teams' : '1 team') : activeTab === 'afk' ? `${raids.length} raids · ${afkEntries.length} date ranges` : activeTab === 'priorities' ? `${priorities.length} records` : activeTab === 'history' ? `${awards.length} records` : `${members.length} members · ${joinRequests.length} requests`}</span></div><div className="toolbar-controls">
              {activeTab === 'teams' && <div className="segmented-control" aria-label="Raid team size">{([10, 20, 40] as const).map((size) => <button key={size} className={raidView === size ? 'segment selected' : 'segment'} onClick={() => setRaidView(size)} aria-pressed={raidView === size}>{size}<span>player</span></button>)}</div>}
              {activeTab !== 'teams' && activeTab !== 'access' && activeTab !== 'afk' && <label className="search-field" htmlFor="table-search"><Search size={15} /><input id="table-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={activeTab === 'roster' ? 'Find a member...' : 'Find item or player...'} /><kbd>Ctrl K</kbd></label>}
            </div></div>
            {activeTab === 'roster' && <RosterTab ctx={ctx} />}
            {activeTab === 'teams' && <TeamsTab ctx={ctx} />}
            {activeTab === 'afk' && <AfkCalendar entries={afkEntries} raids={raids} roster={roster} currentUserId={session.user?.uid ?? ''} busy={busy} onAdd={addAfkEntry} onRemove={removeAfkEntry} />}
            {activeTab === 'priorities' && <PriorityList priorities={filteredPriorities} awards={awards} canEdit={canEditRaidData} busy={busy} onEdit={(priority) => openModal(({ close, live }) => <PriorityModal existing={priority} close={close} live={live} />)} onAward={openAward} onMoveCandidate={moveCandidate} />}
            {activeTab === 'history' && <AwardHistory awards={filteredAwards} />}
            {activeTab === 'access' && effectiveRole === 'Guild Leader' && <GuildAccessManager members={members} roster={roster} requests={joinRequests} busy={busy} canImport={!roster.length && !priorities.length && !awards.length && !Object.keys(assignments).length} onMemberChange={changeMemberAccess} onApprove={approveRequest} onReject={rejectRequest} onImport={importLegacyData} />}
            {(mutationError || dataError) && <p className="app-error" role="alert">{mutationError || dataError}</p>}
            {notice && <p className="app-notice" role="status">{notice}</p>}
            <footer className="panel-footer"><span>{activeTab === 'teams' ? <><strong>{assignedCount}</strong> of <strong>{roster.length}</strong> guild members assigned</> : activeTab === 'access' ? <><strong>{members.length}</strong> active guild accounts</> : activeTab === 'afk' ? <><strong>{raids.length}</strong> raids · <strong>{afkEntries.length}</strong> shared date ranges</> : <>Showing <strong>{activeTab === 'roster' ? filteredRoster.length : activeTab === 'priorities' ? filteredPriorities.length : filteredAwards.length}</strong> of <strong>{activeTab === 'roster' ? roster.length : activeTab === 'priorities' ? priorities.length : filteredAwards.length}</strong></>}</span><span className="footer-right"><span className="save-indicator" /> Shared with guild</span></footer>
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
