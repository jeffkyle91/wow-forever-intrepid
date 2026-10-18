import { useState, type DragEvent as ReactDragEvent, type FormEvent, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import type { PlayerRecord as Player, TenManTeam } from '../../guildApi'
import type { TeamOption } from '../../shared/game/teams'
import { conflictingTeamGroups } from '../../shared/game/teams'
import { classAccent } from '../../shared/game/classes'
import { ClassAvatar } from '../../shared/ui/ClassAvatar'
import { TeamRoleComposition } from './TeamRoleComposition'

export function TenManTeamCard({ teams, team, members, roster, assignments, available, canEdit, coverage, dropActive, onDragStart, onDragOver, onDragLeave, onDrop, onAssign, onMove, onRemove }: {
  teams: TeamOption[]
  team: TeamOption
  members: Player[]
  roster: Player[]
  assignments: Record<string, TenManTeam>
  available: Player[]
  canEdit: boolean
  coverage?: ReactNode
  dropActive: boolean
  onDragStart: (event: ReactDragEvent<HTMLDivElement>, playerId: string) => void
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void
  onDragLeave: () => void
  onDrop: (event: ReactDragEvent<HTMLElement>) => void
  onAssign: (playerId: string, team: TenManTeam) => void
  onMove: (playerId: string, team: TenManTeam) => void
  onRemove: (playerId: string) => void
}) {
  const [selectedId, setSelectedId] = useState('')
  const conflictGroups = conflictingTeamGroups(team.key, roster, assignments)
  function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedId) onAssign(selectedId, team.key)
    setSelectedId('')
  }
  return <article className={`team-card team-card-${team.key}${dropActive ? ' drop-active' : ''}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    <header className="team-card-header"><div className="team-title"><span className={`team-color-mark mark-${team.key}`} /><div><h3>{team.name}</h3><p>10-player group</p></div></div><span className="team-capacity"><strong>{members.length}</strong> / 10</span></header>
    <TeamRoleComposition members={members} />
    {coverage}    <div className="team-member-list">{conflictGroups.length > 0 && <aside className="teams-conflict-warning" role="note"><strong>Same-player assignments</strong><ul>{conflictGroups.map((group) => <li key={group.map((player) => player.id).sort().join(':')}>{group.map((player) => player.name).join(', ')} belong to the same player.</li>)}</ul></aside>}{members.map((player) => <div className={`team-member-row ${classAccent(player.className)}`} key={player.id} draggable={canEdit} onDragStart={(event) => onDragStart(event, player.id)}>
      <ClassAvatar player={player} /><span className="team-member-info"><strong>{player.name}</strong><small>{player.specialization || player.className} · {player.role}</small></span>
      {canEdit ? <><select className="move-team-select" value={team.key} onChange={(event) => onMove(player.id, event.target.value as TenManTeam)} aria-label={`Move ${player.name} to another 10-player team`}>{teams.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}</select><button className="remove-member-button" onClick={() => onRemove(player.id)} title={`Remove ${player.name} from ${team.name}`} aria-label={`Remove ${player.name} from ${team.name}`}><X size={15} /></button></> : <span />}
    </div>)}{!members.length && <p className="team-empty">No members assigned</p>}</div>
    {canEdit && <form className="team-add-form" onSubmit={addMember}><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} aria-label={`Choose a guild member to add to ${team.name}`} disabled={!available.length || members.length >= 10}><option value="">{available.length ? 'Add from guild roster' : 'No unassigned members'}</option>{available.map((player) => <option key={player.id} value={player.id}>{player.name} · {player.specialization || player.className}</option>)}</select><button className="add-team-member" type="submit" disabled={!selectedId || members.length >= 10} aria-label={`Add member to ${team.name}`} title={`Add member to ${team.name}`}><Plus size={16} /></button></form>}
  </article>
}
