import type { AwardRecord as Award, PriorityRecord as LootPriority } from '../../guildApi'
import { listingProgress, nameKey } from './completion'
import { matchesEncounterScope } from './groupPriorities'
import type { PriorityFilters } from './priorityFilters'

export function filterPriorities(priorities: LootPriority[], query: string) {
  return priorities.filter((priority) => `${priority.item} ${priority.encounter} ${priority.rankedPlayers.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
}

export function filterAwards(awards: Award[], query: string) {
  return awards.filter((award) => `${award.item} ${award.encounter} ${award.recipient}`.toLowerCase().includes(query.toLowerCase()))
}

// The search box and the toolbar filters together. slotOf gives the filter's slot choice for a priority, or undefined while its item has not
// been looked up yet (it then matches no slot until it is).
export function visiblePriorities(priorities: LootPriority[], awards: Award[], query: string, filters: PriorityFilters, slotOf: (priority: LootPriority) => string | undefined) {
  const player = nameKey(filters.player)
  return filterPriorities(priorities, query).filter((priority) =>
    matchesEncounterScope(priority.encounter, filters.encounter)
    && (!player || priority.rankedPlayers.some((name) => nameKey(name) === player))
    && (!filters.slot || slotOf(priority) === filters.slot)
    && (!filters.hideCompleted || !listingProgress(priority, awards).complete))
}

function sorted(values: Iterable<string>) {
  return [...values].sort((a, b) => a.localeCompare(b))
}

// The players in the toolbar select. The current choice is always included so it can be cleared even if the data it came from has changed.
export function filterOptions(priorities: LootPriority[], filters: PriorityFilters) {
  const players = new Map<string, string>()
  for (const priority of priorities) for (const name of priority.rankedPlayers) if (!players.has(nameKey(name))) players.set(nameKey(name), name.trim())
  if (filters.player && !players.has(nameKey(filters.player))) players.set(nameKey(filters.player), filters.player)
  return { players: sorted(players.values()) }
}
