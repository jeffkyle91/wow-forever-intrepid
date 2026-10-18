import type { PlayerRecord } from '../../shared/game/players.ts'
import { conflictingAssignedCharacter, type TeamOption } from '../../shared/game/teams.ts'
import type { TenManTeam } from '../../guildApi.ts'

export async function assignTeamMember({ playerId, team, roster, assignments, teams, persist, setMutationError }: {
  playerId: string
  team: TenManTeam
  roster: PlayerRecord[]
  assignments: Record<string, TenManTeam>
  teams: TeamOption[]
  persist: (playerId: string, team: TenManTeam) => Promise<void>
  setMutationError: (message: string) => void
}) {
  const character = roster.find((player) => player.id === playerId)
  if (!character) {
    setMutationError('That character is no longer in the guild roster.')
    return
  }
  if (assignments[playerId] === team) return

  const teamName = teams.find((entry) => entry.key === team)?.name ?? team
  const conflict = conflictingAssignedCharacter(playerId, team, roster, assignments)
  if (conflict) {
    setMutationError(`${character.name} conflicts with ${conflict.name} on ${teamName}: characters belonging to the same player cannot share a raid team.`)
    return
  }
  if (roster.filter((player) => assignments[player.id] === team).length >= 10) {
    setMutationError(`${teamName} is full. Remove or move someone first.`)
    return
  }
  try {
    await persist(playerId, team)
    setMutationError('')
  } catch (error) {
    setMutationError(error instanceof Error ? error.message : 'Could not update raid team.')
  }
}

export async function removeTeamMember(playerId: string, persist: (playerId: string, team: TenManTeam | null) => Promise<void>, setMutationError: (message: string) => void) {
  try {
    await persist(playerId, null)
    setMutationError('')
  } catch (error) {
    setMutationError(error instanceof Error ? error.message : 'Could not remove member from raid team.')
  }
}