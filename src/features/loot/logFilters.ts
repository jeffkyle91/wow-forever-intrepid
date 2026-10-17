import { nameKey } from './completion.ts'
import { matchesEncounterScope } from './groupPriorities.ts'

// What the Log's dropdowns look at. An entry only lists the fields that changed, so the dungeon and boss, the players and the item (for its slot)
// of an entry are worked out from the entry and, where it does not say, from the priority it is about as it stands now. Pure; Node tests it.
type EntryLike = { targetType: string; targetId: string; item: string; before: Record<string, unknown>; after: Record<string, unknown> }
type PriorityLike = { id: string; item: string; encounter: string; rankedPlayers: string[]; itemId?: number }

export type LogFacts = {
  // False for entries that are about no item (a phase started or reopened, a drop list changed): they match none of the item filters.
  about: 'item' | 'phase' | 'table'
  item: string
  itemId?: number
  encounter: string
  players: string[]
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const names = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '') : [])

// Each player once (case and spacing ignored), in the order first seen.
const unique = (players: string[]) => [...new Map(players.filter((name) => name.trim() !== '').map((name) => [nameKey(name), name.trim()])).values()]

export function logFacts(entry: EntryLike, priorityById: (id: string) => PriorityLike | undefined): LogFacts {
  if (entry.targetType === 'phase') return { about: 'phase', item: '', encounter: '', players: [] }
  if (entry.targetType === 'table') return { about: 'table', item: '', encounter: '', players: [] }
  const field = (name: string) => entry.after[name] ?? entry.before[name]
  const priority = priorityById(entry.targetType === 'award' ? text(field('priorityId')) : entry.targetId)
  const itemId = typeof field('itemId') === 'number' ? (field('itemId') as number) : priority?.itemId
  const players = entry.targetType === 'award'
    ? [text(field('recipient')), ...names(field('prioritySnapshot'))]
    : [...names(entry.before.rankedPlayers), ...names(entry.after.rankedPlayers), ...(priority?.rankedPlayers ?? [])]
  return { about: 'item', item: entry.item || priority?.item || '', ...(itemId !== undefined ? { itemId } : {}), encounter: text(field('encounter')) || priority?.encounter || '', players: unique(players) }
}

export type LogFilter = { player: string; slot: string; encounter: string }
export const noLogFilter: LogFilter = { player: '', slot: '', encounter: '' }
export const logFilterActive = (filter: LogFilter) => !!(filter.player || filter.slot || filter.encounter)

// Whether an entry passes the dropdowns. `slotOf` gives the slot choice of an item, or undefined while its lookup has not finished (it matches
// no slot until it has).
export function matchesLogFilter(facts: LogFacts, filter: LogFilter, slotOf: (item: { item: string; itemId?: number }) => string | undefined): boolean {
  if (!logFilterActive(filter)) return true
  if (facts.about !== 'item') return false
  const player = nameKey(filter.player)
  return (!filter.encounter || (facts.encounter !== '' && matchesEncounterScope(facts.encounter, filter.encounter)))
    && (!player || facts.players.some((name) => nameKey(name) === player))
    && (!filter.slot || slotOf({ item: facts.item, itemId: facts.itemId }) === filter.slot)
}

// The players the dropdown offers: every player any entry is about, once each (case and spacing ignored), in alphabetical order.
export function logPlayers(all: LogFacts[], current: string): string[] {
  const seen = new Map<string, string>()
  for (const facts of all) for (const name of facts.players) if (!seen.has(nameKey(name))) seen.set(nameKey(name), name.trim())
  if (current && !seen.has(nameKey(current))) seen.set(nameKey(current), current)
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}
