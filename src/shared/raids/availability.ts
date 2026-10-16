import type { AfkEntryRecord, PlayerRecord } from '../../guildApi'
import type { RaidSignup } from '../../raidSignups'

export function unavailableOn(entries: AfkEntryRecord[], uid: string, date: string): boolean {
  return entries.some((entry) => entry.userId === uid && entry.startDate <= date && date <= entry.endDate)
}

// Availability is authoritative even while the scheduled-raid trigger is still synchronizing responses.
export function effectiveRaidSignups(signups: RaidSignup[], entries: AfkEntryRecord[], roster: PlayerRecord[], date: string): RaidSignup[] {
  const responses = new Map(signups.map((signup) => [signup.id, signup]))
  for (const entry of entries) {
    if (entry.startDate > date || date > entry.endDate) continue
    const characterId = responses.get(entry.userId)?.characterId ?? roster.find((player) => player.linkedUid === entry.userId && !player.mainId)?.id
    if (characterId) responses.set(entry.userId, { id: entry.userId, characterId, status: 'absent' })
  }
  return [...responses.values()]
}
