import type { PlayerRecord as Player } from '../../guildApi'

export function filterRoster(roster: Player[], query: string) {
  return roster.filter((player) => `${player.name} ${player.className} ${player.specialization ?? ''} ${player.role}`.toLowerCase().includes(query.toLowerCase()))
}
