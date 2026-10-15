import { setTeamAssignment, type TenManTeam } from '../../guildApi'
import { namedTeams } from '../../shared/game/teams'
import type { TabContext } from '../../shared/tabs/types'
import { RaidTeamsView } from './RaidTeamsView'

export function TeamsTab({ ctx }: { ctx: TabContext }) {
  const { roster, assignments } = ctx.data
  const { setMutationError } = ctx.feedback
  const teams = namedTeams(ctx.data.settings.teamNames)

  async function assignMember(playerId: string, team: TenManTeam) {
    if (assignments[playerId] === team) return
    if (roster.filter((player) => assignments[player.id] === team).length >= 10) {
      setMutationError(`${teams.find((entry) => entry.key === team)?.name} is full. Remove or move someone first.`)
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

  return <RaidTeamsView teams={teams} groupNames={ctx.data.settings.groupNames} players={roster} assignments={assignments} view={ctx.shell.raidView} canEdit={ctx.identity.canEditRaidData} onAssign={assignMember} onRemove={removeMemberFromTeams} />
}
