import type { RaidGroup, TenManTeam } from '../../guildApi'

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

export function conflictingAssignedCharacter<T extends TeamCharacter>(characterId: string, team: TenManTeam, roster: T[], assignments: Record<string, TenManTeam>) {
  return roster.find((character) => character.id !== characterId
    && assignments[character.id] === team
    && samePlayer(characterId, character.id, roster))
}

export function conflictingTeamGroups<T extends TeamCharacter>(team: TenManTeam, roster: T[], assignments: Record<string, TenManTeam>) {
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

// The four 10-player teams with the names a Guild Leader chose in Settings.
export const namedTeams = (names: Record<TenManTeam, string>): TeamOption[] => tenManTeams.map((team) => ({ key: team.key, name: names[team.key] }))

export type GroupDefinition = { key: RaidGroup; size: 20 | 40; parts: TenManTeam[] }

export const groups20: GroupDefinition[] = [
  { key: 'green', size: 20, parts: ['blue', 'yellow'] },
  { key: 'pink', size: 20, parts: ['red', 'white'] },
]

export const group40: GroupDefinition = { key: 'brown', size: 40, parts: tenManTeams.map((team) => team.key) }
