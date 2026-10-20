import { setTeamAssignment, type StandingTeam } from '../../guildApi'
import { namedTeams, standingAssignments, standingTeamOptions } from '../../shared/game/teams'
import type { TabContext } from '../../shared/tabs/types'
import { assignTeamMember, removeTeamMember } from './assignment'
import { TeamConflictModal } from './TeamConflictModal'
import { RaidTeamsView } from './RaidTeamsView'
import '../../shared/teams/Teams.css'

export function TeamsTab({ ctx }: { ctx: TabContext }) {
  const { roster, readiness } = ctx.data
  const assignments = standingAssignments(ctx.data, ctx.shell.raidView)
  const { setMutationError } = ctx.feedback
  const teams = standingTeamOptions(ctx.shell.raidView, ctx.data.settings.teamNames, ctx.data.settings.groupNames)
  const size = ctx.shell.raidView
  const persist = (playerId: string, team: StandingTeam | null) => setTeamAssignment(playerId, team, size)
  const readyIds = new Set(readiness.filter((entry) => entry.ready).map((entry) => entry.id))

  async function assignMember(playerId: string, team: StandingTeam) {
    if (!readyIds.has(playerId)) { setMutationError('Mark this character ready to raid before adding or moving it. Existing unready assignments can be removed.'); return }
    await assignTeamMember({
      playerId,
      team,
      roster,
      assignments,
      teams,
      persist,
      onConflict: (conflict) => ctx.openModal(({ close }) => <TeamConflictModal conflict={conflict} close={close} />),
      setMutationError,
    })
  }

  async function removeMemberFromTeams(playerId: string) {
    await removeTeamMember(playerId, persist, setMutationError)
  }

  if (ctx.data.readinessError) return <p role="alert">Could not load the available roster: {ctx.data.readinessError}</p>
  if (ctx.data.dataError) return <p role="alert">Could not load standing teams: {ctx.data.dataError}</p>
  if (!ctx.data.readinessLoaded || !ctx.data.raidPlanningLoaded) return <p role="status">Loading standing teams and raid readiness...</p>
  return <RaidTeamsView key={size} teams={namedTeams(ctx.data.settings.teamNames)} groupNames={ctx.data.settings.groupNames} players={roster} readyIds={readyIds} assignments={assignments} view={size} canEdit={ctx.identity.canEditRaidData} onAssign={assignMember} onRemove={removeMemberFromTeams} />
}
