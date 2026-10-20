import { useState, type DragEvent as ReactDragEvent } from 'react'
import type { PlayerRecord as Player, RaidGroup, StandingTeam } from '../../guildApi'
import { altIds } from '../../shared/game/alts'
import { group40, groups20, type RaidView, type TeamOption } from '../../shared/game/teams'
import { useHideAlts } from './altVisibility'
import { GuildRosterPool } from '../../shared/teams/GuildRosterPool'
import { StandingTeamCard } from '../../shared/teams/StandingTeamCard'
import { RaidCoveragePanel } from '../../shared/raid-coverage/RaidCoveragePanel'
import { RaidCoverageStrip } from '../../shared/raid-coverage/RaidCoverageStrip'

export function RaidTeamsView({ teams, groupNames, players, readyIds, assignments, view, canEdit, onAssign, onRemove }: {
  teams: TeamOption[]
  groupNames: Record<RaidGroup, string>
  players: Player[]
  readyIds: ReadonlySet<string>
  assignments: Record<string, StandingTeam>
  view: RaidView
  canEdit: boolean
  onAssign: (playerId: string, team: StandingTeam) => void
  onRemove: (playerId: string) => void
}) {
  const [activeDropTarget, setActiveDropTarget] = useState<StandingTeam | 'roster' | null>(null)
  const currentTeams = view === 10 ? teams : (view === 20 ? groups20 : [group40]).map((team) => ({ key: team.key, name: groupNames[team.key] }))
  const membersFor = (team: StandingTeam) => players.filter((player) => assignments[player.id] === team)
  // Hide alts only narrows the characters still to be placed. Characters already on a team always show, and the buff coverage
  // counts every assigned character.
  const hideAlts = useHideAlts()
  const alts = altIds(players)
  const unassigned = players.filter((player) => !assignments[player.id] && readyIds.has(player.id))
  const available = hideAlts ? unassigned.filter((player) => !alts.has(player.id)) : unassigned
  function acceptDrop(event: ReactDragEvent<HTMLElement>, team: StandingTeam) {
    event.preventDefault()
    if (canEdit) setActiveDropTarget(team)
  }
  function assignDrop(event: ReactDragEvent<HTMLElement>, team: StandingTeam) {
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
        <div className={`team-grid ${view === 10 ? 'team-grid-four' : view === 20 ? 'team-grid-two' : 'team-grid-one'}`}>{currentTeams.map((team) => <StandingTeamCard key={team.key} team={team} teams={currentTeams} members={membersFor(team.key)} roster={players} assignments={assignments} available={available} canEdit={canEdit} coverage={<RaidCoverageStrip parts={[team.key]} players={players} assignments={assignments} />} dropActive={activeDropTarget === team.key} onDragStart={(event, playerId) => { event.dataTransfer.setData('text/plain', playerId); event.dataTransfer.effectAllowed = 'move' }} onDragOver={(event) => acceptDrop(event, team.key)} onDragLeave={() => setActiveDropTarget(null)} onDrop={(event) => assignDrop(event, team.key)} onAssign={onAssign} onMove={onAssign} onRemove={onRemove} />)}</div>
      </div>
    </div>
    <RaidCoveragePanel view={view} teams={teams} groupNames={groupNames} players={players} assignments={assignments} />
  </div>
}
