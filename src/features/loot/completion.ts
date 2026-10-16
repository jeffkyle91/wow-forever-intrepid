// Structural types, so this file has no imports and can be tested directly by Node. PriorityRecord and AwardRecord
// (guildApi.ts) satisfy them.
type LootPriority = { id: string; item: string; rankedPlayers: string[] }
type Award = { priorityId?: string; item: string; recipient: string }

// Positional completion: a player listed twice for an item is satisfied once per receipt. Only the number of
// receipts counts, not their dates. The first N listings of a player (in list order) are received, where N is the
// number of that player's active awards of the item; the rest stay open. Awards of other items or to other players
// never count, and a removed award stops counting.

export function nameKey(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

// An award counts toward a priority when it was recorded from that priority, or, when it has no priority at all
// (a later manual entry or import), when it is for an item of the same name.
export function awardsForPriority(priority: LootPriority, awards: Award[]) {
  const itemKey = nameKey(priority.item)
  return awards.filter((award) => award.priorityId ? award.priorityId === priority.id : nameKey(award.item) === itemKey)
}

// The client does not write a status yet; the rules already allow `status: 'removed'` on an award.
export function isRemovedAward(award: Award) {
  return (award as { status?: unknown }).status === 'removed'
}

export type ListingProgress = {
  // Same order as priority.rankedPlayers.
  received: boolean[]
  // Index of the first listing still open, or -1 when every listing has been received (or there are none).
  next: number
  // At least one listing, and all of them received.
  complete: boolean
}

export function listingProgress(priority: LootPriority, awards: Award[]): ListingProgress {
  const credits = new Map<string, number>()
  for (const award of awardsForPriority(priority, awards)) {
    if (isRemovedAward(award)) continue
    const key = nameKey(award.recipient)
    credits.set(key, (credits.get(key) ?? 0) + 1)
  }
  const received = priority.rankedPlayers.map((name) => {
    const key = nameKey(name)
    const left = credits.get(key) ?? 0
    if (left <= 0) return false
    credits.set(key, left - 1)
    return true
  })
  const next = received.indexOf(false)
  return { received, next, complete: received.length > 0 && next === -1 }
}

export type RecipientChoice = { name: string; listed: number; received: number }

// One choice per distinct player on the list (case and spacing ignored), with how many of that player's listings
// are received. Used by the award dialog so a player listed twice appears once.
export function recipientChoices(priority: LootPriority, progress: ListingProgress): RecipientChoice[] {
  const choices = new Map<string, RecipientChoice>()
  priority.rankedPlayers.forEach((name, index) => {
    const key = nameKey(name)
    const choice = choices.get(key) ?? { name, listed: 0, received: 0 }
    choice.listed += 1
    if (progress.received[index]) choice.received += 1
    choices.set(key, choice)
  })
  return [...choices.values()]
}
