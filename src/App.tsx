import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  Check, ChevronDown, LogOut, Moon, Plus, Search, Shield, Sun,
} from 'lucide-react'
import { signOut } from 'firebase/auth'
import { createAfkEntry, createAward, createRaidEvent, deleteAfkEntry, approveJoinRequest, importLocalPreviewData, rejectJoinRequest, saveGuildRecord, setTeamAssignment, updateMembershipAccess, type AwardRecord, type JoinRequestRecord, type PlayerRecord, type PriorityRecord, type RaidRecord, type TenManTeam } from './guildApi'
import { auth } from './firebase'
import { canManageRaidData, canManageRoster, guildRoles, type GuildRole } from './security'
import { useGuildData } from './useGuildData'
import { useGuildSession } from './useGuildSession'
import { AccessScreen } from './AccessScreen'
import { AfkCalendar } from './AfkCalendar'
import {
  guildCrest, membersArt, raidArt, lootArt, coinsArt, trophyArt,
  accessArt, seasonArt, calendarArt, guildArt,
} from './shared/art'
import { type Role } from './shared/game/classes'
import { tenManTeams, type RaidView } from './shared/game/teams'
import { localDateKey } from './shared/lib/dates'
import { ArtIcon } from './shared/ui/ArtIcon'
import { EmptyRow } from './shared/ui/EmptyRow'
import { Modal } from './shared/ui/Modal'
import { PlayerForm } from './features/roster/PlayerForm'
import { RosterTable } from './features/roster/RosterTable'
import { RaidTeamsView } from './features/teams/RaidTeamsView'
import { AwardHistory } from './features/loot/AwardHistory'
import { PriorityList } from './features/loot/PriorityList'
import './App.css'

type Tab = 'roster' | 'teams' | 'afk' | 'priorities' | 'history' | 'access'
type Player = PlayerRecord
type LootPriority = PriorityRecord
type Award = AwardRecord
type ModalState =
  | { kind: 'player'; player?: Player }
  | { kind: 'priority'; priority?: LootPriority }
  | { kind: 'award'; priority: LootPriority; awardedAt: string }
  | { kind: 'raid'; date: string }
  | null

function App() {
  const session = useGuildSession()
  const actualRole = session.membership?.role ?? null
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('intrepid-theme') === 'dark' ? 'dark' : 'light')
  const [selectedTab, setActiveTab] = useState<Tab>('priorities')
  const [raidView, setRaidView] = useState<RaidView>(10)
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<ModalState>(null)
  const [impersonatedRole, setImpersonatedRole] = useState<GuildRole | null>(null)
  const [mutationError, setMutationError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const { roster, assignments, priorities, awards, afkEntries, raids, members, joinRequests, dataError } = useGuildData(session.status === 'active', actualRole)
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
  const filteredRoster = roster.filter((player) => `${player.name} ${player.className} ${player.specialization ?? ''} ${player.role}`.toLowerCase().includes(query.toLowerCase()))
  const assignedCount = roster.filter((player) => assignments[player.id]).length
  const filteredPriorities = priorities.filter((priority) => `${priority.item} ${priority.encounter} ${priority.rankedPlayers.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const filteredAwards = awards.filter((award) => `${award.item} ${award.encounter} ${award.recipient}`.toLowerCase().includes(query.toLowerCase()))

  async function savePlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const player: Player = {
      id: modal?.kind === 'player' && modal.player ? modal.player.id : crypto.randomUUID(),
      name: String(data.get('name')).trim(),
      className: String(data.get('className')).trim(),
      specialization: String(data.get('specialization')).trim(),
      role: String(data.get('role')) as Role,
    }
    setBusy(true)
    try {
      const { id, ...record } = player
      await saveGuildRecord('roster', id, record)
      setMutationError('')
      setModal(null)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not save guild member.')
    } finally {
      setBusy(false)
    }
  }

  async function savePriority(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const priority: LootPriority = {
      id: modal?.kind === 'priority' && modal.priority ? modal.priority.id : crypto.randomUUID(),
      item: String(data.get('item')).trim(),
      encounter: String(data.get('encounter')).trim(),
      rankedPlayers: String(data.get('rankedPlayers')).split(',').map((name) => name.trim()).filter(Boolean),
      councilNote: String(data.get('councilNote')).trim(),
    }
    setBusy(true)
    try {
      const { id, ...record } = priority
      await saveGuildRecord('lootPriorities', id, record)
      setMutationError('')
      setModal(null)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not save loot priority.')
    } finally {
      setBusy(false)
    }
  }

  async function recordAward(event: FormEvent<HTMLFormElement>, priority: LootPriority) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const award: Omit<Award, 'id'> = {
      priorityId: priority.id,
      item: priority.item,
      encounter: priority.encounter,
      recipient: String(data.get('recipient')),
      awardedAt: String(data.get('awardedAt')),
      prioritySnapshot: [...priority.rankedPlayers],
      councilNoteSnapshot: priority.councilNote,
      awardNote: String(data.get('awardNote')).trim(),
    }
    setBusy(true)
    try {
      await createAward(award)
      setMutationError('')
      setModal(null)
      setActiveTab('history')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not record loot award.')
    } finally {
      setBusy(false)
    }
  }

  async function saveRaid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const date = String(data.get('date') ?? '')
    const name = String(data.get('name') ?? '').trim()
    const size = Number(data.get('size'))
    if (!session.user || !date || !name || ![10, 20, 40].includes(size)) {
      setMutationError('Enter a raid name, date, and a valid raid size.')
      return
    }

    setBusy(true)
    try {
      await createRaidEvent({ date, name, size: size as RaidRecord['size'] }, session.user.uid)
      setMutationError('')
      setNotice('Raid added to the calendar.')
      setModal(null)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not add raid.')
    } finally {
      setBusy(false)
    }
  }

  function openAward(priority: LootPriority) {
    const now = new Date()
    const localDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
    setModal({ kind: 'award', priority, awardedAt: localDate })
  }

  async function assignMember(playerId: string, team: TenManTeam) {
    if (assignments[playerId] === team) return
    if (roster.filter((player) => assignments[player.id] === team).length >= 10) {
      setMutationError(`${tenManTeams.find((entry) => entry.key === team)?.name} is full. Remove or move someone first.`)
      return
    }
    try {
      await setTeamAssignment(playerId, team)
      setMutationError('')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not update raid team.')
    }
  }

  async function removeMemberFromTeams(playerId: string) {
    try {
      await setTeamAssignment(playerId, null)
      setMutationError('')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not remove member from raid team.')
    }
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
            {activeTab === 'roster' && canEditRoster && <button className="button button-primary" onClick={() => setModal({ kind: 'player' })}><Plus size={16} /> Add member</button>}
            {activeTab === 'afk' && canEditRaidData && <button className="button button-primary" onClick={() => setModal({ kind: 'raid', date: localDateKey(new Date()) })}><Plus size={16} /> Add Raid</button>}
            {activeTab === 'priorities' && canEditRaidData && <button className="button button-primary" onClick={() => setModal({ kind: 'priority' })}><Plus size={16} /> Add priority</button>}
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
            {activeTab === 'roster' && <RosterTable players={filteredRoster} assignments={assignments} canEdit={canEditRoster} onEdit={(player) => setModal({ kind: 'player', player })} />}
            {activeTab === 'teams' && <RaidTeamsView players={roster} assignments={assignments} view={raidView} canEdit={canEditRaidData} onAssign={assignMember} onRemove={removeMemberFromTeams} />}
            {activeTab === 'afk' && <AfkCalendar entries={afkEntries} raids={raids} roster={roster} currentUserId={session.user?.uid ?? ''} busy={busy} onAdd={addAfkEntry} onRemove={removeAfkEntry} />}
            {activeTab === 'priorities' && <PriorityList priorities={filteredPriorities} awards={awards} canEdit={canEditRaidData} busy={busy} onEdit={(priority) => setModal({ kind: 'priority', priority })} onAward={openAward} onMoveCandidate={moveCandidate} />}
            {activeTab === 'history' && <AwardHistory awards={filteredAwards} />}
            {activeTab === 'access' && effectiveRole === 'Guild Leader' && <GuildAccessManager members={members} roster={roster} requests={joinRequests} busy={busy} canImport={!roster.length && !priorities.length && !awards.length && !Object.keys(assignments).length} onMemberChange={changeMemberAccess} onApprove={approveRequest} onReject={rejectRequest} onImport={importLegacyData} />}
            {(mutationError || dataError) && <p className="app-error" role="alert">{mutationError || dataError}</p>}
            {notice && <p className="app-notice" role="status">{notice}</p>}
            <footer className="panel-footer"><span>{activeTab === 'teams' ? <><strong>{assignedCount}</strong> of <strong>{roster.length}</strong> guild members assigned</> : activeTab === 'access' ? <><strong>{members.length}</strong> active guild accounts</> : activeTab === 'afk' ? <><strong>{raids.length}</strong> raids · <strong>{afkEntries.length}</strong> shared date ranges</> : <>Showing <strong>{activeTab === 'roster' ? filteredRoster.length : activeTab === 'priorities' ? filteredPriorities.length : filteredAwards.length}</strong> of <strong>{activeTab === 'roster' ? roster.length : activeTab === 'priorities' ? priorities.length : filteredAwards.length}</strong></>}</span><span className="footer-right"><span className="save-indicator" /> Shared with guild</span></footer>
          </section>
          <p className="preview-note"><Shield size={14} /> Guild data is shared with authorized guild accounts and protected by Firestore rules.</p>
        </div>
      </main>

      {modal?.kind === 'player' && <Modal title={modal.player ? 'Edit member' : 'Add guild member'} onClose={() => setModal(null)}><PlayerForm player={modal.player} busy={busy} onSubmit={savePlayer} onCancel={() => setModal(null)} /></Modal>}
      {modal?.kind === 'raid' && <Modal title="Add Raid" onClose={() => setModal(null)}><form className="modal-form" onSubmit={saveRaid}>
        <label>Raid name<input name="name" placeholder="e.g. Karazhan" maxLength={80} required autoFocus /></label>
        <div className="form-grid"><label>Date<input name="date" type="date" defaultValue={modal.date} required /></label><label>Raid size<select name="size" defaultValue="10"><option value="10">10-player</option><option value="20">20-player</option><option value="40">40-player</option></select></label></div>
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={busy}><Plus size={15} /> Add Raid</button></div>
      </form></Modal>}
      {modal?.kind === 'priority' && <Modal title={modal.priority ? 'Edit loot priority' : 'Add loot priority'} onClose={() => setModal(null)}><form className="modal-form" onSubmit={savePriority}>
        <label>Item name<input name="item" defaultValue={modal.priority?.item} placeholder="e.g. Signet of the Deep Earth" required autoFocus /></label>
        <label>Raid · encounter<input name="encounter" defaultValue={modal.priority?.encounter} placeholder="Raid name · Boss name" required /></label>
        <label>Ranked candidates <span className="field-hint">Comma-separated, highest priority first</span><input name="rankedPlayers" defaultValue={modal.priority?.rankedPlayers.join(', ')} placeholder="Morrow, Aurelia, Vex" /></label>
        <label>Council note<textarea name="councilNote" defaultValue={modal.priority?.councilNote} rows={3} placeholder="Why this order? What should council consider?" /></label>
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={busy}><Check size={15} /> Save priority</button></div>
      </form></Modal>}
      {modal?.kind === 'award' && <Modal title="Record loot award" onClose={() => setModal(null)}><div className="award-modal-item"><span className="item-gem"><ArtIcon src={coinsArt} className="loot-art-icon" /></span><span><strong>{modal.priority.item}</strong><small>{modal.priority.encounter}</small></span></div><form className="modal-form" onSubmit={(event) => recordAward(event, modal.priority)}>
        <label>Awarded to<select name="recipient" defaultValue={modal.priority.rankedPlayers[0] ?? ''} required>{modal.priority.rankedPlayers.map((name) => <option key={name}>{name}</option>)}</select></label>
        <label>Award date<input type="date" name="awardedAt" defaultValue={modal.awardedAt} required /></label>
        <label>Council decision note<textarea name="awardNote" rows={3} placeholder="Optional context for the permanent record" /></label>
        <p className="snapshot-callout"><Shield size={15} /> The current priority order and council note will be saved with this award.</p>
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={busy || modal.priority.rankedPlayers.length === 0}><Check size={15} /> Record award</button></div>
      </form></Modal>}
    </div>
  )
}

function NavButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; count: number }) {
  return <button className={active ? 'nav-item active' : 'nav-item'} onClick={onClick}>{icon}<span>{label}</span><span className="nav-count">{count}</span></button>
}

function Stat({ icon, tone, label, value, detail }: { icon: ReactNode; tone: string; label: string; value: number; detail: string }) {
  return <div className="stat-cell"><span className={`stat-icon ${tone}`}>{icon}</span><span className="stat-label">{label}</span><strong>{value}<small> {detail}</small></strong></div>
}

function GuildAccessManager({ members, roster, requests, busy, canImport, onMemberChange, onApprove, onReject, onImport }: {
  members: { id: string; email: string; displayName: string; role: GuildRole; playerId?: string | null }[]
  roster: Player[]
  requests: JoinRequestRecord[]
  busy: boolean
  canImport: boolean
  onMemberChange: (uid: string, role: GuildRole, playerId: string | null) => void
  onApprove: (request: JoinRequestRecord, role: GuildRole, playerId: string | null) => void
  onReject: (uid: string) => void
  onImport: () => void
}) {
  const [requestRoles, setRequestRoles] = useState<Record<string, GuildRole>>({})
  const [requestPlayers, setRequestPlayers] = useState<Record<string, string>>({})

  return <div className="access-management">
    {canImport && <section className="import-notice"><div><strong>Existing browser data found?</strong><p>Import this browser’s roster, raid assignments, loot priorities, and award history into the shared guild space.</p></div><button className="button button-secondary" disabled={busy} onClick={onImport}>Import local data</button></section>}
    <section className="access-section"><header className="access-section-heading"><div><h3>Join requests</h3><p>Approve a request to create the member’s guild account and assign a role.</p></div><span className="access-count">{requests.length} pending</span></header>
      {requests.length ? <div className="request-list">{requests.map((request) => <article className="request-row" key={request.id}><span className="request-avatar">{request.displayName.slice(0, 1).toUpperCase()}</span><div className="request-person"><strong>{request.displayName}</strong><small>{request.email}</small></div><label className="request-role">Assign role<select value={requestRoles[request.id] ?? 'Member'} onChange={(event) => setRequestRoles((current) => ({ ...current, [request.id]: event.target.value as GuildRole }))} disabled={busy}>{guildRoles.map((role) => <option key={role}>{role}</option>)}</select></label><label className="request-character">Link character<select value={requestPlayers[request.id] ?? ''} onChange={(event) => setRequestPlayers((current) => ({ ...current, [request.id]: event.target.value }))} disabled={busy}><option value="">Link later</option>{roster.filter((player) => !player.linkedUid).map((player) => <option key={player.id} value={player.id}>{player.name} · {player.className}</option>)}</select></label><button className="button button-primary request-approve" disabled={busy} onClick={() => onApprove(request, requestRoles[request.id] ?? 'Member', requestPlayers[request.id] || null)}><Check size={14} /> Approve</button><button className="button button-secondary request-reject" disabled={busy} onClick={() => onReject(request.userId)}>Decline</button></article>)}</div> : <div className="access-empty">No pending access requests.</div>}
    </section>
    <section className="access-section"><header className="access-section-heading"><div><h3>Guild accounts</h3><p>Roles are enforced by Firestore. Only Guild Leaders can change access.</p></div><span className="access-count">{members.length} active</span></header>
      <div className="table-scroll"><table className="data-table member-access-table"><thead><tr><th>MEMBER</th><th>EMAIL</th><th>CHARACTER</th><th>ROLE</th></tr></thead><tbody>{members.map((member) => <tr key={member.id}><td><strong>{member.displayName || 'Unnamed member'}</strong></td><td>{member.email}</td><td><select className="member-role-select" value={member.playerId ?? ''} disabled={busy} aria-label={`Roster character for ${member.displayName || member.email}`} onChange={(event) => onMemberChange(member.id, member.role, event.target.value || null)}><option value="">No linked character</option>{roster.filter((player) => !player.linkedUid || player.linkedUid === member.id).map((player) => <option key={player.id} value={player.id}>{player.name} · {player.className}</option>)}</select></td><td><select className="member-role-select" value={member.role} disabled={busy} aria-label={`Role for ${member.displayName || member.email}`} onChange={(event) => onMemberChange(member.id, event.target.value as GuildRole, member.playerId ?? null)}>{guildRoles.map((role) => <option key={role}>{role}</option>)}</select></td></tr>)}{!members.length && <EmptyRow colSpan={4} title="No guild accounts" detail="Provision the first Guild Leader in Firebase, then manage the rest here." />}</tbody></table></div>
    </section>
  </div>
}

export default App
