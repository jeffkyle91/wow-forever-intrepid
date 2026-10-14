import type { TenManTeam } from '../../guildApi'

export type RaidView = 10 | 20 | 40

export const tenManTeams: { key: TenManTeam; name: string }[] = [
  { key: 'blue', name: 'Blue' },
  { key: 'yellow', name: 'Yellow' },
  { key: 'red', name: 'Red' },
  { key: 'white', name: 'White' },
]

export const groups20 = [
  { name: 'Green', parts: ['blue', 'yellow'] as TenManTeam[] },
  { name: 'Pink', parts: ['red', 'white'] as TenManTeam[] },
]
