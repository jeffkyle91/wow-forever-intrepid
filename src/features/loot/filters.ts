import type { AwardRecord as Award, PriorityRecord as LootPriority } from '../../guildApi'
import { readLines, type Who } from '../../shared/game/candidates.ts'
import { listingProgress, type PriorityLookup } from './completion.ts'
import { matchesEncounterScope } from './groupPriorities.ts'
import type { PriorityFilters } from './priorityFilters'

// The text the search box looks at: the item, the dungeon and boss, and the name of every line (a character's current name, or the text of a note).
export function filterPriorities(priorities: LootPriority[], query: string, who: Who) {
  const needle = query.toLowerCase()
  return priorities.filter((priority) => `${priority.item} ${priority.encounter} ${readLines(priority).map((line) => who.nameOf(line)).join(' ')}`.toLowerCase().includes(needle))
}

// The search box and the toolbar filters together. slotOf gives the filter's slot choice for a priority, or undefined while its item has not
// been looked up yet (it then matches no slot until it is). The player filter holds a person key (see makeWho), so a character is found under
// a new name and by an old name alike.
export function visiblePriorities(priorities: LootPriority[], awards: Award[], query: string, filters: PriorityFilters, slotOf: (priority: LootPriority) => string | undefined, lookup: PriorityLookup | undefined, who: Who) {
  return filterPriorities(priorities, query, who).filter((priority) =>
    matchesEncounterScope(priority.encounter, filters.encounter)
    && (!filters.player || readLines(priority).some((line) => who.lineKey(line) === filters.player))
    && (!filters.slot || slotOf(priority) === filters.slot)
    && (!filters.hideCompleted || !listingProgress(priority, awards, lookup, who).complete))
}

export type PlayerOption = { key: string; name: string }

// The players in the toolbar select: each person on any character line once, by current name. The current choice is always included so it can be
// cleared even if the data it came from has changed.
export function filterOptions(priorities: LootPriority[], filters: PriorityFilters, who: Who): { players: PlayerOption[] } {
  const players = new Map<string, string>()
  for (const priority of priorities) {
    for (const line of readLines(priority)) {
      const key = who.lineKey(line)
      if (key !== undefined && !players.has(key)) players.set(key, who.nameOf(line).trim())
    }
  }
  if (filters.player && !players.has(filters.player)) players.set(filters.player, filters.player.replace(/^(id|name):/, ''))
  return { players: [...players].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name)) }
}
