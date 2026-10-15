import type { PlayerRecord as Player, TenManTeam } from '../../guildApi'
import type { TeamOption } from '../../shared/game/teams'
import { ClassAvatar } from '../../shared/ui/ClassAvatar'
import { TeamRoleComposition } from './TeamRoleComposition'

export function DerivedTeamCard({ teams, name, parts, players, assignments }: {
  teams: TeamOption[]
  name: string
  parts: TenManTeam[]
  players: Player[]
  assignments: Record<string, TenManTeam>
}) {
  const sourceTeams = parts.map((key) => teams.find((team) => team.key === key)!).filter(Boolean)
  const members = players.filter((player) => parts.includes(assignments[player.id]))
  const memberCount = members.length
  const equation = sourceTeams.map((team) => team.name).join(' + ')

  return <article className={`team-card derived-team team-card-${name.toLowerCase()}`}>
    <header className="team-card-header"><div className="team-title"><span className={`team-color-mark mark-${name.toLowerCase()}`} /><div><h3>{name}</h3><p>{name === 'Brown' ? '40-player raid team' : '20-player raid team'}</p></div></div><span className="team-capacity"><strong>{memberCount}</strong> / {name === 'Brown' ? 40 : 20}</span></header>
    <TeamRoleComposition members={members} />
    <div className="derived-equation">{equation} <span>= {name}</span></div>
    <div className="derived-groups">{sourceTeams.map((team) => {
      const members = players.filter((player) => assignments[player.id] === team.key)
      return <section className="derived-subteam" key={team.key}>
        <header className="derived-subteam-heading"><span className="derived-subteam-name"><span className={`team-color-mark mark-${team.key}`} aria-hidden="true" />{team.name}</span><span>{members.length} / 10</span></header>
        {members.length ? <div className="derived-member-list">{members.map((player) => <span className="derived-member" key={player.id}><ClassAvatar player={player} /><strong>{player.name}</strong><small>{player.specialization || player.className} · {player.role}</small></span>)}</div> : <p className="team-empty">No members in {team.name}</p>}
      </section>
    })}</div>
    <p className="derived-note">Membership is combined from the 10-player groups and managed on the 10-player view.</p>
  </article>
}
