import { useState, type DragEvent as ReactDragEvent } from 'react'
import type { PlayerRecord as Player, TenManTeam } from '../../guildApi'
import { groups20, tenManTeams, type RaidView, type TeamOption } from '../../shared/game/teams'
import { DerivedTeamCard } from './DerivedTeamCard'
import { GuildRosterPool } from './GuildRosterPool'
import { TenManTeamCard } from './TenManTeamCard'

export function RaidTeamsView({ teams, players, assignments, view, canEdit, onAssign, onRemove }: {
  teams: TeamOption[]
  players: Player[]
  assignments: Record<string, TenManTeam>
  view: RaidView
  canEdit: boolean
  onAssign: (playerId: string, team: TenManTeam) => void
  onRemove: (playerId: string) => void
}) {
  const [activeDropTarget, setActiveDropTarget] = useState<TenManTeam | 'roster' | null>(null)
  const membersFor = (team: TenManTeam) => players.filter((player) => assignments[player.id] === team)
  function acceptDrop(event: ReactDragEvent<HTMLElement>, team: TenManTeam) {
    event.preventDefault()
    if (canEdit) setActiveDropTarget(team)
  }
  function assignDrop(event: ReactDragEvent<HTMLElement>, team: TenManTeam) {
    event.preventDefault()
    setActiveDropTarget(null)
    const playerId = event.dataTransfer.getData('text/plain')
    if (canEdit && playerId) onAssign(playerId, team)
  }
  function unassignDrop(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault()
    setActiveDropTarget(null)
    const playerId = event.dataTransfer.getData('text/plain')
    if (canEdit && playerId && assignments[playerId]) onRemove(playerId)
  }

  return <div className="raid-team-view">
    <div className="raid-team-workbench">
      <GuildRosterPool players={players.filter((player) => !assignments[player.id])} totalPlayers={players.length} canEdit={canEdit} dropActive={activeDropTarget === 'roster'} onDragStart={(event, playerId) => { event.dataTransfer.setData('text/plain', playerId); event.dataTransfer.effectAllowed = 'move' }} onDragOver={(event) => { if (canEdit) { event.preventDefault(); setActiveDropTarget('roster') } }} onDragLeave={() => setActiveDropTarget(null)} onDrop={unassignDrop} />
      <div className="raid-team-views">
        {view === 10 && <div className="team-grid team-grid-four">{teams.map((team) => <TenManTeamCard key={team.key} team={team} teams={teams} members={membersFor(team.key)} available={players.filter((player) => !assignments[player.id])} canEdit={canEdit} dropActive={activeDropTarget === team.key} onDragStart={(event, playerId) => { event.dataTransfer.setData('text/plain', playerId); event.dataTransfer.effectAllowed = 'move' }} onDragOver={(event) => acceptDrop(event, team.key)} onDragLeave={() => setActiveDropTarget(null)} onDrop={(event) => assignDrop(event, team.key)} onAssign={onAssign} onMove={onAssign} onRemove={onRemove} />)}</div>}
        {view === 20 && <div className="team-grid team-grid-two">{groups20.map((group) => <DerivedTeamCard key={group.name} teams={teams} name={group.name} parts={group.parts} players={players} assignments={assignments} />)}</div>}
        {view === 40 && <div className="team-grid team-grid-one"><DerivedTeamCard teams={teams} name="Brown" parts={tenManTeams.map((team) => team.key)} players={players} assignments={assignments} /></div>}
      </div>
    </div>
  </div>
}
