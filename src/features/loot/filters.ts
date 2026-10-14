import type { AwardRecord as Award, PriorityRecord as LootPriority } from '../../guildApi'

export function filterPriorities(priorities: LootPriority[], query: string) {
  return priorities.filter((priority) => `${priority.item} ${priority.encounter} ${priority.rankedPlayers.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
}

export function filterAwards(awards: Award[], query: string) {
  return awards.filter((award) => `${award.item} ${award.encounter} ${award.recipient}`.toLowerCase().includes(query.toLowerCase()))
}
