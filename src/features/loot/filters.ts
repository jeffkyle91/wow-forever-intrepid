import type { AwardRecord as Award, PlayerRecord as Player, PriorityRecord as LootPriority } from '../../guildApi'
import { listingProgress, nameKey } from './completion'
import type { PriorityFilters } from './priorityFilters'

export function filterPriorities(priorities: LootPriority[], query: string) {
  return priorities.filter((priority) => `${priority.item} ${priority.encounter} ${priority.rankedPlayers.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
}

export function filterAwards(awards: Award[], query: string) {
  return awards.filter((award) => `${award.item} ${award.encounter} ${award.recipient}`.toLowerCase().includes(query.toLowerCase()))
}

// The search box and the toolbar filters together. A candidate's class comes from the roster entry with the same name;
// a candidate who is not on the roster has no class.
export function visiblePriorities(priorities: LootPriority[], awards: Award[], roster: Player[], query: string, filters: PriorityFilters) {
  const classByName = new Map(roster.map((player) => [nameKey(player.name), player.className]))
  const player = nameKey(filters.player)
  return filterPriorities(priorities, query).filter((priority) =>
    (!filters.encounter || priority.encounter.trim() === filters.encounter)
    && (!player || priority.rankedPlayers.some((name) => nameKey(name) === player))
    && (!filters.className || priority.rankedPlayers.some((name) => classByName.get(nameKey(name)) === filters.className))
    && (!filters.hideCompleted || !listingProgress(priority, awards).complete))
}

function sorted(values: Iterable<string>) {
  return [...values].sort((a, b) => a.localeCompare(b))
}

// The choices in the toolbar selects. The current choice is always included so it can be cleared even if the data
// it came from has changed.
export function filterOptions(priorities: LootPriority[], roster: Player[], filters: PriorityFilters) {
  const classByName = new Map(roster.map((player) => [nameKey(player.name), player.className]))
  const encounters = new Set(priorities.map((priority) => priority.encounter.trim()).filter(Boolean))
  const players = new Map<string, string>()
  const classes = new Set<string>()
  for (const priority of priorities) for (const name of priority.rankedPlayers) {
    if (!players.has(nameKey(name))) players.set(nameKey(name), name.trim())
    const className = classByName.get(nameKey(name))
    if (className) classes.add(className)
  }
  if (filters.encounter) encounters.add(filters.encounter)
  if (filters.className) classes.add(filters.className)
  if (filters.player && !players.has(nameKey(filters.player))) players.set(nameKey(filters.player), filters.player)
  return { encounters: sorted(encounters), players: sorted(players.values()), classes: sorted(classes) }
}
