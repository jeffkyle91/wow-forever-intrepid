import { Award, CalendarDays, CalendarOff, CornerDownRight, Gem, MessageSquare, Plus, Shield, Swords, Trash2, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { deleteAfkEntry, isRaidCancelled, type TenManTeam } from '../../guildApi'
import { group40, groups20 } from '../../shared/game/teams'
import { localDateKey } from '../../shared/lib/dates'
import type { TabContext } from '../../shared/tabs/types'
import { ClassAvatar } from '../../shared/ui/ClassAvatar'
import { RolePill } from '../../shared/ui/RolePill'
import { AbsenceModal } from './AbsenceModal'
import { CommentsPanel } from './CommentsPanel'
import { findMyCharacters, myAbsences, myAwards, myPriorities, upcomingRaids } from './myCharacters'
import './Dashboard.css'

const dateLabel = (key: string) => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

function Panel({ icon, title, action, children }: { icon: ReactNode; title: string; action?: ReactNode; children: ReactNode }) {
  const heading = <h3>{icon}{title}</h3>
  return <section className="dash-card">{action ? <div className="dash-card-head">{heading}{action}</div> : heading}{children}</section>
}

export function DashboardTab({ ctx }: { ctx: TabContext }) {
  const { roster, assignments, priorities, awards, raids, afkEntries, settings } = ctx.data
  const [today] = useState(() => localDateKey(new Date()))
  const { linked, characters } = findMyCharacters(roster, ctx.identity.uid)

  if (!linked) {
    return <div className="dash-empty">
      <Shield size={26} />
      <h3>No character linked to your account yet</h3>
      <p>Ask a Guild Leader to link your character in Member Access. Your characters, raid team, loot priorities and upcoming raids will appear here once they do.</p>
      <p>Everything else in the app still works. You can look at the roster, raid teams, calendar and loot in the meantime.</p>
      <div className="dash-actions">
        <button className="button button-secondary" onClick={() => ctx.navigate('afk')}>Raid calendar</button>
        <button className="button button-secondary" onClick={() => ctx.navigate('teams')}>Raid teams</button>
        <button className="button button-secondary" onClick={() => ctx.navigate('priorities')}>Loot priorities</button>
      </div>
    </div>
  }

  const raidList = upcomingRaids(raids, afkEntries, ctx.identity.uid, today)
  const prios = myPriorities(priorities, characters)
  const loot = myAwards(awards, characters)
  const absences = myAbsences(afkEntries, ctx.identity.uid, today)
  const teamName = (team: TenManTeam) => settings.teamNames[team]
  const groupLabel = (team: TenManTeam) => {
    const group = groups20.find((entry) => entry.parts.includes(team))
    return `${group ? `${settings.groupNames[group.key]} (20) · ` : ''}${settings.groupNames[group40.key]} (40)`
  }

  async function removeAbsence(entryId: string) {
    const { setBusy, setMutationError, setNotice } = ctx.feedback
    setBusy(true)
    try {
      await deleteAfkEntry(entryId)
      setMutationError('')
      setNotice('Unavailable dates removed.')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not remove unavailable dates.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="dash-grid">
    <Panel icon={<Swords size={15} />} title="My characters">
      <ul className="dash-list">{characters.map((character, index) => <li key={character.id}>
        <span className="dash-character">{index > 0 && <CornerDownRight className="alt-link-icon" size={14} aria-hidden="true" />}<ClassAvatar player={character} /><span><strong>{character.name}{character.surname ? ` ${character.surname}` : ''}</strong><small>{character.specialization} {character.className} · {index === 0 ? 'Main' : 'Alt'}</small></span></span>
        <RolePill role={character.role} />
      </li>)}</ul>
    </Panel>

    <Panel icon={<Users size={15} />} title="My raid team">
      <ul className="dash-list">{characters.map((character) => {
        const team = assignments[character.id]
        return <li key={character.id}>
          <span><strong>{character.name}</strong><small>{team ? `${teamName(team)} team` : 'Not assigned to a team'}</small></span>
          {team && <span className="dash-tag">{groupLabel(team)}</span>}
        </li>
      })}</ul>
    </Panel>

    <Panel icon={<CalendarDays size={15} />} title="Upcoming raids">
      {raidList.length ? <ul className="dash-list">{raidList.map(({ raid, unavailable }) => <li key={raid.id}>
        <span><strong>{raid.name}</strong><small>{dateLabel(raid.date)} · {raid.size}-player{isRaidCancelled(raid) && raid.cancelReason ? ` · ${raid.cancelReason}` : ''}</small></span>
        {isRaidCancelled(raid) ? <span className="dash-tag dash-tag-warn">Cancelled</span> : unavailable && <span className="dash-tag dash-tag-warn">You marked unavailable</span>}
      </li>)}</ul> : <p className="dash-muted">No upcoming raids are scheduled.</p>}
      <p className="dash-note">Raid sign-ups are coming. For now, mark dates you cannot raid under Upcoming absences.</p>
    </Panel>

    <Panel icon={<CalendarOff size={15} />} title="Upcoming absences" action={<button className="button button-secondary" onClick={() => ctx.openModal(({ close, live }) => <AbsenceModal today={today} close={close} live={live} />)}><Plus size={14} /> Add absence</button>}>
      {absences.length ? <ul className="dash-list">{absences.map((entry) => <li key={entry.id}>
        <span><strong>{entry.startDate === entry.endDate ? dateLabel(entry.startDate) : `${dateLabel(entry.startDate)} – ${dateLabel(entry.endDate)}`}</strong></span>
        <button className="dash-icon-button" aria-label="Remove absence" title="Remove absence" disabled={ctx.feedback.busy} onClick={() => removeAbsence(entry.id)}><Trash2 size={14} /></button>
      </li>)}</ul> : <p className="dash-muted">No upcoming absences.</p>}
    </Panel>

    <Panel icon={<Gem size={15} />} title="My loot priorities">
      {prios.length ? <ul className="dash-list">{prios.map(({ priority, position, character }) => <li key={`${priority.id}-${character.id}`}>
        <span><strong>{priority.item}</strong><small>{priority.encounter || 'No encounter'} · {character.name}</small></span>
        <span className="dash-tag">#{position}</span>
      </li>)}</ul> : <p className="dash-muted">None of your characters are on a loot priority list yet.</p>}
    </Panel>

    <Panel icon={<Award size={15} />} title="My awarded loot">
      {loot.length ? <ul className="dash-list">{loot.slice(0, 5).map((award) => <li key={award.id}>
        <span><strong>{award.item}</strong><small>{award.encounter || 'No encounter'} · {award.awardedAt}</small></span>
        <span className="dash-tag">{award.recipient}</span>
      </li>)}</ul> : <p className="dash-muted">No loot has been awarded to your characters yet.</p>}
    </Panel>

    <Panel icon={<MessageSquare size={15} />} title="Comments">
      <CommentsPanel ctx={ctx} />
    </Panel>
  </div>
}
