import type { AfkEntryRecord, AwardRecord, PlayerRecord, PriorityRecord, RaidRecord } from '../../guildApi'

// The character a Guild Leader linked to this account, plus its main and that main's alts.
export function findMyCharacters(roster: PlayerRecord[], uid: string): { linked: PlayerRecord | null; characters: PlayerRecord[] } {
  const linked = uid ? roster.find((player) => player.linkedUid === uid) ?? null : null
  if (!linked) return { linked: null, characters: [] }
  // A link to a missing character or to another alt is ignored, as on the roster.
  const candidate = linked.mainId ? roster.find((player) => player.id === linked.mainId) : undefined
  const main = candidate && !candidate.mainId ? candidate : linked
  const alts = roster.filter((player) => player.mainId === main.id && player.id !== main.id)
  return { linked, characters: [main, ...alts] }
}

// Priorities and awards still store typed names, so match a character by id or by first name.
const matches = (value: string, player: PlayerRecord) => value === player.id || value.trim().toLowerCase() === player.name.trim().toLowerCase()

export type MyPriority = { priority: PriorityRecord; position: number; character: PlayerRecord }

export function myPriorities(priorities: PriorityRecord[], characters: PlayerRecord[]): MyPriority[] {
  const result: MyPriority[] = []
  for (const priority of priorities) {
    for (const character of characters) {
      const index = priority.rankedPlayers.findIndex((entry) => matches(entry, character))
      if (index >= 0) result.push({ priority, position: index + 1, character })
    }
  }
  return result.sort((a, b) => a.position - b.position || a.priority.item.localeCompare(b.priority.item))
}

export function myAwards(awards: AwardRecord[], characters: PlayerRecord[]) {
  return awards.filter((award) => characters.some((character) => matches(award.recipient, character)))
}

export type UpcomingRaid = { raid: RaidRecord; unavailable: boolean }

export function upcomingRaids(raids: RaidRecord[], afkEntries: AfkEntryRecord[], uid: string, today: string, limit = 5): UpcomingRaid[] {
  return raids
    .filter((raid) => raid.date >= today)
    .slice(0, limit)
    .map((raid) => ({ raid, unavailable: afkEntries.some((entry) => entry.userId === uid && entry.startDate <= raid.date && raid.date <= entry.endDate) }))
}

export function myAbsences(afkEntries: AfkEntryRecord[], uid: string, today: string): AfkEntryRecord[] {
  return afkEntries.filter((entry) => entry.userId === uid && entry.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate))
}
