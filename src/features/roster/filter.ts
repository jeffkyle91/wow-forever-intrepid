import type { PlayerRecord as Player } from '../../guildApi'

// Alt id -> main name. A link to a missing character, or to another alt, is ignored.
export function mainNameByPlayer(roster: Player[]) {
  const mains = new Map(roster.filter((player) => !player.mainId).map((player) => [player.id, player.name]))
  return new Map(roster.flatMap((player) => {
    const name = player.mainId ? mains.get(player.mainId) : undefined
    return name && player.mainId !== player.id ? [[player.id, name] as const] : []
  }))
}

export function filterRoster(roster: Player[], query: string) {
  const mainNames = mainNameByPlayer(roster)
  return roster.filter((player) => `${player.name} ${player.className} ${player.specialization ?? ''} ${player.role} ${mainNames.get(player.id) ?? ''}`.toLowerCase().includes(query.toLowerCase()))
}