import type { RaidGroup, StandingTeam, TenManTeam } from '../../guildApi'

export type RaidView = 10 | 20 | 40
export type TeamCharacter = { id: string; mainId?: string }

// Only a valid direct link to a main identifies two character ids as the same player.
export function playerIdentity(characterId: string, roster: TeamCharacter[]) {
  const character = roster.find((entry) => entry.id === characterId)
  if (!character?.mainId || character.mainId === character.id) return characterId
  const main = roster.find((entry) => entry.id === character.mainId)
  return main && !main.mainId ? main.id : characterId
}

export function samePlayer(firstId: string, secondId: string, roster: TeamCharacter[]) {
  return playerIdentity(firstId, roster) === playerIdentity(secondId, roster)
}

export function conflictingAssignedCharacter<T extends TeamCharacter>(characterId: string, team: StandingTeam, roster: T[], assignments: Record<string, StandingTeam>) {
  return roster.find((character) => character.id !== characterId
    && assignments[character.id] === team
    && samePlayer(characterId, character.id, roster))
}

export function conflictingTeamGroups<T extends TeamCharacter>(team: StandingTeam, roster: T[], assignments: Record<string, StandingTeam>) {
  const groups = new Map<string, T[]>()
  for (const character of roster) {
    if (assignments[character.id] !== team) continue
    const identity = playerIdentity(character.id, roster)
    groups.set(identity, [...(groups.get(identity) ?? []), character])
  }
  return [...groups.values()].filter((group) => group.length > 1)
}

export const tenManTeams: { key: TenManTeam; name: string }[] = [
  { key: 'blue', name: 'Blue' },
  { key: 'yellow', name: 'Yellow' },
  { key: 'red', name: 'Red' },
  { key: 'white', name: 'White' },
]

export type TeamOption = { key: TenManTeam; name: string }
export type StandingTeamOption = { key: StandingTeam; name: string }

// The four 10-player teams with the names a Guild Leader chose in Settings.
export const namedTeams = (names: Record<TenManTeam, string>): TeamOption[] => tenManTeams.map((team) => ({ key: team.key, name: names[team.key] }))

export type GroupDefinition = { key: RaidGroup; size: 20 | 40 }

export const groups20: GroupDefinition[] = [
  { key: 'green', size: 20 },
  { key: 'pink', size: 20 },
]

export const group40: GroupDefinition = { key: 'brown', size: 40 }

export function standingTeamOptions(size: RaidView, teamNames: Record<TenManTeam, string>, groupNames: Record<RaidGroup, string>): StandingTeamOption[] {
  return size === 10 ? namedTeams(teamNames) : (size === 20 ? groups20 : [group40]).map((team) => ({ key: team.key, name: groupNames[team.key] }))
}

export function standingAssignments(data: {
  assignments: Record<string, TenManTeam>
  assignments20: Record<string, 'green' | 'pink'>
  assignments40: Record<string, 'brown'>
}, size: RaidView): Record<string, StandingTeam> {
  return size === 10 ? data.assignments : size === 20 ? data.assignments20 : data.assignments40
}

export const standingTeamSize = (team: StandingTeam): RaidView => team === 'brown' ? 40 : team === 'green' || team === 'pink' ? 20 : 10
