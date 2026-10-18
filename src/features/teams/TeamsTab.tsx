import { setTeamAssignment, type TenManTeam } from '../../guildApi'
import { namedTeams } from '../../shared/game/teams'
import type { TabContext } from '../../shared/tabs/types'
import { assignTeamMember, removeTeamMember } from './assignment'
import { RaidTeamsView } from './RaidTeamsView'
import './Teams.css'

export function TeamsTab({ ctx }: { ctx: TabContext }) {
  const { roster, assignments } = ctx.data
  const { setMutationError } = ctx.feedback
  const teams = namedTeams(ctx.data.settings.teamNames)

  async function assignMember(playerId: string, team: TenManTeam) {
    await assignTeamMember({ playerId, team, roster, assignments, teams, persist: setTeamAssignment, setMutationError })
  }

  async function removeMemberFromTeams(playerId: string) {
    await removeTeamMember(playerId, setTeamAssignment, setMutationError)
  }

  return <RaidTeamsView teams={teams} groupNames={ctx.data.settings.groupNames} players={roster} assignments={assignments} view={ctx.shell.raidView} canEdit={ctx.identity.canEditRaidData} onAssign={assignMember} onRemove={removeMemberFromTeams} />
}
