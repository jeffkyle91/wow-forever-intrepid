import type { GuildSettings, PlayerRecord, TenManTeam } from '../../guildApi'
import type { RaidSignup } from '../../raidSignups'
import { tenManTeams } from '../game/teams.ts'

export function signupCharacters(roster: PlayerRecord[], uid: string): PlayerRecord[] {
  const main = uid ? roster.find((player) => player.linkedUid === uid && !player.mainId) : undefined
  return main ? [main, ...roster.filter((player) => player.mainId === main.id && (!player.linkedUid || player.linkedUid === uid))] : []
}

export function canViewRaidTeam(signup?: RaidSignup): boolean {
  return signup !== undefined && ['accept', 'tentative', 'late'].includes(signup.status)
}

export function raidSignupTeam(signup: RaidSignup | undefined, roster: PlayerRecord[], assignments: Record<string, TenManTeam>, settings: GuildSettings) {
  if (!canViewRaidTeam(signup) || !signup) return undefined
  const team = tenManTeams.find((entry) => entry.key === assignments[signup.characterId])
  if (!team) return undefined
  return {
    key: team.key,
    name: settings.teamNames[team.key],
    players: roster.filter((player) => assignments[player.id] === team.key).sort((a, b) => a.name.localeCompare(b.name)),
  }
}
