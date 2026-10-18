import { useState, type DragEvent as ReactDragEvent } from 'react'
import type { PlayerRecord as Player, RaidGroup, TenManTeam } from '../../guildApi'
import { altIds } from '../../shared/game/alts'
import { group40, groups20, type RaidView, type TeamOption } from '../../shared/game/teams'
import { useHideAlts } from './altVisibility'
import { DerivedTeamCard } from './DerivedTeamCard'
import { GuildRosterPool } from './GuildRosterPool'
import { TenManTeamCard } from './TenManTeamCard'
import { RaidCoveragePanel } from '../../shared/raid-coverage/RaidCoveragePanel'
import { RaidCoverageStrip } from '../../shared/raid-coverage/RaidCoverageStrip'

export function RaidTeamsView({ teams, groupNames, players, assignments, view, canEdit, onAssign, onRemove }: {
  teams: TeamOption[]
  groupNames: Record<RaidGroup, string>
  players: Player[]
  assignments: Record<string, TenManTeam>
  view: RaidView
  canEdit: boolean
  onAssign: (playerId: string, team: TenManTeam) => void
  onRemove: (playerId: string) => void
}) {
  const [activeDropTarget, setActiveDropTarget] = useState<TenManTeam | 'roster' | null>(null)
  const membersFor = (team: TenManTeam) => players.filter((player) => assignments[player.id] === team)
  // Hide alts only narrows the characters still to be placed. Characters already on a team always show, and the buff coverage
  // counts every assigned character.
  const hideAlts = useHideAlts()
  const alts = altIds(players)
  const unassigned = players.filter((player) => !assignments[player.id])
  const available = hideAlts ? unassigned.filter((player) => !alts.has(player.id)) : unassigned
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
      <GuildRosterPool players={available} hiddenAlts={unassigned.length - available.length} totalPlayers={players.length} canEdit={canEdit} dropActive={activeDropTarget === 'roster'} onDragStart={(event, playerId) => { event.dataTransfer.setData('text/plain', playerId); event.dataTransfer.effectAllowed = 'move' }} onDragOver={(event) => { if (canEdit) { event.preventDefault(); setActiveDropTarget('roster') } }} onDragLeave={() => setActiveDropTarget(null)} onDrop={unassignDrop} />
      <div className="raid-team-views">
        {view === 10 && <div className="team-grid team-grid-four">{teams.map((team) => <TenManTeamCard key={team.key} team={team} teams={teams} members={membersFor(team.key)} roster={players} assignments={assignments} available={available} canEdit={canEdit} coverage={<RaidCoverageStrip parts={[team.key]} players={players} assignments={assignments} />} dropActive={activeDropTarget === team.key} onDragStart={(event, playerId) => { event.dataTransfer.setData('text/plain', playerId); event.dataTransfer.effectAllowed = 'move' }} onDragOver={(event) => acceptDrop(event, team.key)} onDragLeave={() => setActiveDropTarget(null)} onDrop={(event) => assignDrop(event, team.key)} onAssign={onAssign} onMove={onAssign} onRemove={onRemove} />)}</div>}
        {view === 20 && <div className="team-grid team-grid-two">{groups20.map((group) => <DerivedTeamCard key={group.key} teams={teams} groupKey={group.key} name={groupNames[group.key]} size={group.size} parts={group.parts} players={players} assignments={assignments} coverage={<RaidCoverageStrip parts={group.parts} players={players} assignments={assignments} />} />)}</div>}
        {view === 40 && <div className="team-grid team-grid-one"><DerivedTeamCard teams={teams} groupKey={group40.key} name={groupNames[group40.key]} size={group40.size} parts={group40.parts} players={players} assignments={assignments} coverage={<RaidCoverageStrip parts={group40.parts} players={players} assignments={assignments} />} /></div>}
      </div>
    </div>
    <RaidCoveragePanel view={view} teams={teams} groupNames={groupNames} players={players} assignments={assignments} />
  </div>
}
