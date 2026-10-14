import type { TenManTeam } from '../../guildApi'

export type RaidView = 10 | 20 | 40

export const tenManTeams: { key: TenManTeam; name: string }[] = [
  { key: 'blue', name: 'Blue' },
  { key: 'yellow', name: 'Yellow' },
  { key: 'red', name: 'Red' },
  { key: 'white', name: 'White' },
]
