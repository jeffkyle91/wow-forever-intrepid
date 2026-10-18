import { makeWho, nameKey, readLines, type Who } from './candidates.ts'
import { phaseNoOf } from './phases.ts'

export { nameKey }

// Structural types, so this file can be tested directly by Node. PriorityRecord and AwardRecord (guildApi.ts) satisfy them.
type LootPriority = { id: string; item: string; rankedPlayers: string[]; rankedIds?: string[]; phaseNo?: number; carriedFrom?: string }
type Award = { priorityId?: string; item: string; recipient: string; recipientId?: string; phaseNo?: number }

// Who a line and an award are about, when the roster is not at hand: the id if there is one, else the name. The app passes the roster's, which also
// recognizes a name that is a roster character's as that character (so an award with only a name still counts for the character's line).
const noRoster = makeWho([])

// Positional completion: a player listed twice for an item is satisfied once per receipt. Only the number of
// receipts counts, not their dates. The first N listings of a player (in list order) are received, where N is the
// number of that player's active awards of the item; the rest stay open. Awards of other items or to other players
// never count, and a removed award stops counting.

// Finds a priority by id, for following where an item was carried over from.
export type PriorityLookup = (id: string) => LootPriority | undefined
export const priorityLookup = <T extends LootPriority>(priorities: T[]): PriorityLookup => {
  const byId = new Map(priorities.map((priority) => [priority.id, priority]))
  return (id) => byId.get(id)
}

// A priority carried over from an earlier phase keeps what that phase's awards said: the priorities it came from, the one before that, and so on
// (at most MAX_CARRY steps, and never twice the same one). Their ids and phases are what awards are matched against.
const MAX_CARRY = 20
function carriedFrom(priority: LootPriority, lookup?: PriorityLookup) {
  const ids = new Set([priority.id])
  const phases = new Set([phaseNoOf(priority)])
  let current = priority
  for (let step = 0; step < MAX_CARRY; step++) {
    const from = current.carriedFrom
    if (!from || ids.has(from)) break
    ids.add(from)
    const source = lookup?.(from)
    if (!source) break
    phases.add(phaseNoOf(source))
    current = source
  }
  return { ids, phases }
}

// An award counts toward a priority when it was recorded from that priority (or from one it was carried over from), or, when it has no priority
// at all (a later manual entry or import), when it is for an item of the same name in the same phase (or in a phase it was carried over from).
// Without a lookup, only the priority itself counts.
export function awardsForPriority<A extends Award>(priority: LootPriority, awards: A[], lookup?: PriorityLookup): A[] {
  const itemKey = nameKey(priority.item)
  const from = carriedFrom(priority, lookup)
  return awards.filter((award) => award.priorityId ? from.ids.has(award.priorityId) : nameKey(award.item) === itemKey && from.phases.has(phaseNoOf(award)))
}

// The client does not write a status yet; the rules already allow `status: 'removed'` on an award.
export function isRemovedAward(award: Award) {
  return (award as { status?: unknown }).status === 'removed'
}

export type ListingProgress = {
  // Same order as the lines of the priority (see readLines): a note is never received, it is open or finished.
  received: boolean[]
  // Index of the first line still open (a character not yet received, or an open note), or -1 when none is.
  next: number
  // At least one line, and none open: every character received, every note finished.
  complete: boolean
}

export function listingProgress(priority: LootPriority, awards: Award[], lookup?: PriorityLookup, who: Who = noRoster): ListingProgress {
  const lines = readLines(priority)
  const credits = new Map<string, number>()
  for (const award of awardsForPriority(priority, awards, lookup)) {
    if (isRemovedAward(award)) continue
    const key = who.awardKey(award)
    credits.set(key, (credits.get(key) ?? 0) + 1)
  }
  const received = lines.map((line) => {
    const key = who.lineKey(line)
    if (key === undefined) return false
    const left = credits.get(key) ?? 0
    if (left <= 0) return false
    credits.set(key, left - 1)
    return true
  })
  const open = lines.map((line, index) => (line.kind === 'note' ? !line.done : !received[index]))
  return { received, next: open.indexOf(true), complete: lines.length > 0 && !open.includes(true) }
}

export type RecipientChoice = { key: string; name: string; id?: string; listed: number; received: number }

// One choice per distinct person on the character lines (a person listed twice appears once), with how many of that person's listings are received.
// The name is the roster's current one. Used by the award dialog.
export function recipientChoices(priority: LootPriority, progress: ListingProgress, who: Who = noRoster): RecipientChoice[] {
  const choices = new Map<string, RecipientChoice>()
  readLines(priority).forEach((line, index) => {
    const key = who.lineKey(line)
    if (key === undefined || line.kind !== 'character') return
    const choice = choices.get(key) ?? { key, name: who.nameOf(line), ...(line.id !== undefined ? { id: line.id } : {}), listed: 0, received: 0 }
    choice.listed += 1
    if (progress.received[index]) choice.received += 1
    choices.set(key, choice)
  })
  return [...choices.values()]
}
