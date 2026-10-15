import type { PlayerRecord as Player } from '../../guildApi'

// Alt id -> main name. A link to a missing character, or to another alt, is ignored.
export function mainNameByPlayer(roster: Player[]) {
  const mains = new Map(roster.filter((player) => !player.mainId).map((player) => [player.id, player.name]))
  return new Map(roster.flatMap((player) => {
    const name = player.mainId ? mains.get(player.mainId) : undefined
    return name && player.mainId !== player.id ? [[player.id, name] as const] : []
  }))
}

export type RosterRow = { player: Player; isAlt: boolean; altCount: number }

// Puts each visible alt right under its visible main. altCount counts every alt of a main (shown or not); the
// alts are hidden while that main is collapsed. An alt whose main is not visible stays a normal row.
export function groupAlts(visible: Player[], roster: Player[], collapsed: Set<string>) {
  const mainNames = mainNameByPlayer(roster)
  const visibleIds = new Set(visible.map((player) => player.id))
  const nested = (player: Player) => !!player.mainId && mainNames.has(player.id) && visibleIds.has(player.mainId)
  const altCounts = new Map<string, number>()
  for (const player of roster) if (player.mainId && mainNames.has(player.id)) altCounts.set(player.mainId, (altCounts.get(player.mainId) ?? 0) + 1)
  const rows: RosterRow[] = []
  for (const player of visible) {
    if (nested(player)) continue
    rows.push({ player, isAlt: false, altCount: altCounts.get(player.id) ?? 0 })
    if (collapsed.has(player.id)) continue
    for (const alt of visible) if (alt.mainId === player.id && nested(alt)) rows.push({ player: alt, isAlt: true, altCount: 0 })
  }
  return { rows, mainNames }
}

export function filterRoster(roster: Player[], query: string) {
  const mainNames = mainNameByPlayer(roster)
  return roster.filter((player) => `${player.name} ${player.surname ?? ''} ${player.className} ${player.specialization ?? ''} ${player.role} ${mainNames.get(player.id) ?? ''}`.toLowerCase().includes(query.toLowerCase()))
}