import { useState, type DragEvent as ReactDragEvent, type FormEvent, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import type { PlayerRecord as Player, StandingTeam } from '../../guildApi'
import type { StandingTeamOption } from '../game/teams'
import { conflictingTeamGroups, standingTeamSize } from '../game/teams'
import { classAccent } from '../game/classes'
import { ClassAvatar } from '../ui/ClassAvatar'
import { TeamRoleComposition } from './TeamRoleComposition'

export function StandingTeamCard({ teams, team, members, roster, assignments, available, canEdit, coverage, dropActive, onDragStart, onDragOver, onDragLeave, onDrop, onAssign, onMove, onRemove, subtitle, memberNote, memberStatus, extraDestinations = [], onExtraMove, showConflicts = true, busy = false, occupiedCount = members.length }: {
  teams: StandingTeamOption[]
  team: StandingTeamOption
  members: Player[]
  roster: Player[]
  assignments: Record<string, StandingTeam>
  available: Player[]
  canEdit: boolean
  coverage?: ReactNode
  subtitle?: string
  memberNote?: (player: Player) => ReactNode
  memberStatus?: (player: Player) => ReactNode
  extraDestinations?: { key: string; name: string }[]
  onExtraMove?: (playerId: string, destination: string) => void
  showConflicts?: boolean
  busy?: boolean
  occupiedCount?: number
  dropActive: boolean
  onDragStart: (event: ReactDragEvent<HTMLDivElement>, playerId: string) => void
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void
  onDragLeave: () => void
  onDrop: (event: ReactDragEvent<HTMLElement>) => void
  onAssign: (playerId: string, team: StandingTeam) => void
  onMove: (playerId: string, team: StandingTeam) => void
  onRemove: (playerId: string) => void
}) {
  const [selectedId, setSelectedId] = useState('')
  const size = standingTeamSize(team.key)
  const conflictGroups = conflictingTeamGroups(team.key, roster, assignments)
  function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedId) onAssign(selectedId, team.key)
    setSelectedId('')
  }
  return <article className={`team-card team-card-${team.key}${dropActive ? ' drop-active' : ''}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    <header className="team-card-header"><div className="team-title"><span className={`team-color-mark mark-${team.key}`} /><div><h3>{team.name}</h3><p>{subtitle ?? `Independent ${size}-player team`}</p></div></div><span className="team-capacity"><strong>{occupiedCount}</strong> / {size}</span></header>
    <TeamRoleComposition members={members} />
    {coverage}    <div className="team-member-list">{showConflicts && conflictGroups.length > 0 && <aside className="teams-conflict-warning" role="note"><strong>Same-player assignments</strong><ul>{conflictGroups.map((group) => <li key={group.map((player) => player.id).sort().join(':')}>{group.map((player) => player.name).join(', ')} belong to the same player.</li>)}</ul></aside>}{members.map((player) => <div className={`team-member-row ${classAccent(player.className)}${memberStatus ? ` team-member-row-with-status${canEdit ? ' team-member-row-editable' : ''}` : ''}`} key={player.id} draggable={canEdit && !busy} onDragStart={(event) => onDragStart(event, player.id)}>
      <ClassAvatar player={player} /><span className="team-member-info"><strong>{player.name}</strong><small>{player.specialization || player.className} · {player.role}</small>{memberNote?.(player)}</span>
      {memberStatus && <span className="team-member-status">{memberStatus(player)}</span>}
      {canEdit ? <><select className="move-team-select" value={team.key} disabled={busy} onChange={(event) => { const destination = teams.find((option) => option.key === event.target.value); if (destination) onMove(player.id, destination.key); else if (extraDestinations.some((option) => option.key === event.target.value)) onExtraMove?.(player.id, event.target.value) }} aria-label={`Move ${player.name} to another ${size}-player team`}>{teams.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}{extraDestinations.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}</select><button className="remove-member-button" disabled={busy} onClick={() => onRemove(player.id)} title={`Remove ${player.name} from ${team.name}`} aria-label={`Remove ${player.name} from ${team.name}`}><X size={15} /></button></> : <span />}
    </div>)}{!members.length && <p className="team-empty">{occupiedCount ? 'Assigned characters no longer on roster' : 'No members assigned'}</p>}</div>
    {canEdit && <form className="team-add-form" onSubmit={addMember}><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} aria-label={`Choose a guild member to add to ${team.name}`} disabled={busy || !available.length || occupiedCount >= size}><option value="">{available.length ? 'Add from ready roster' : 'No ready unassigned characters'}</option>{available.map((player) => <option key={player.id} value={player.id}>{player.name} · {player.specialization || player.className}</option>)}</select><button className="add-team-member" type="submit" disabled={busy || !selectedId || occupiedCount >= size} aria-label={`Add member to ${team.name}`} title={`Add member to ${team.name}`}><Plus size={16} /></button></form>}
  </article>
}
