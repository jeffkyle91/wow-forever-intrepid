import type { PlayerRecord } from '../../shared/game/players.ts'
import { conflictingAssignedCharacter, standingTeamSize, type StandingTeamOption } from '../../shared/game/teams.ts'
import type { StandingTeam } from '../../guildApi.ts'

export type TeamAssignmentConflict = { characterName: string; conflictingCharacterName: string; teamName: string }

export async function assignTeamMember({ playerId, team, roster, assignments, teams, persist, onConflict, setMutationError }: {
  playerId: string
  team: StandingTeam
  roster: PlayerRecord[]
  assignments: Record<string, StandingTeam>
  teams: readonly StandingTeamOption[]
  persist: (playerId: string, team: StandingTeam) => Promise<void>
  onConflict: (conflict: TeamAssignmentConflict) => void
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
    onConflict({ characterName: character.name, conflictingCharacterName: conflict.name, teamName })
    return
  }
  if (roster.filter((player) => assignments[player.id] === team).length >= standingTeamSize(team)) {
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

export async function removeTeamMember(playerId: string, persist: (playerId: string, team: StandingTeam | null) => Promise<void>, setMutationError: (message: string) => void) {
  try {
    await persist(playerId, null)
    setMutationError('')
  } catch (error) {
    setMutationError(error instanceof Error ? error.message : 'Could not remove member from raid team.')
  }
}