import type { RaidGroup, TenManTeam } from '../../guildApi'

export type RaidView = 10 | 20 | 40

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
