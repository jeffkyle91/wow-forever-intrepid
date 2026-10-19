import { lineFields, readLines } from '../../shared/game/candidates.ts'
import { nameKey } from './completion.ts'
import { matchesEncounterScope } from './groupPriorities.ts'

// Carrying an item over: a priority of an earlier phase becomes a new priority in a later one with the same item, dungeon and boss, note and the
// whole candidate list in the same order (the ids too, so a character line stays that character and a note stays a note). Who already received it is not copied: the new priority points at the one it came from (`carriedFrom`)
// and the awards recorded from that one count toward it (completion.ts), so the earlier phase's record is never touched and nothing is written
// twice. No other imports, so Node runs its tests directly.
type Source = { id: string; item: string; encounter: string; rankedPlayers: string[]; rankedIds?: string[]; councilNote: string; itemId?: number; zoneId?: number; npcId?: number }

export function carryOverFields(source: Source, phaseNo: number) {
  return {
    item: source.item,
    encounter: source.encounter,
    ...lineFields(readLines(source)),
    councilNote: source.councilNote,
    ...(source.itemId !== undefined ? { itemId: source.itemId } : {}),
    ...(source.zoneId !== undefined ? { zoneId: source.zoneId } : {}),
    ...(source.npcId !== undefined ? { npcId: source.npcId } : {}),
    phaseNo,
    carriedFrom: source.id,
  }
}

// Whether the item is already on the target phase's list: the same item id, or (for one typed by hand) the same name. There is one priority per
// item per phase.
export function onTargetList(target: { item: string; itemId?: number }[], source: { item: string; itemId?: number }) {
  const name = nameKey(source.item)
  return target.some((priority) => (source.itemId !== undefined && priority.itemId === source.itemId) || (name !== '' && nameKey(priority.item) === name))
}

// The same test as onTargetList for a whole dialog's worth of priorities: the target list is read once into sets (item ids and item names), so asking about each priority of the
// earlier phase does not walk the target list again.
export function targetIndex(target: { item: string; itemId?: number }[]): (source: { item: string; itemId?: number }) => boolean {
  const ids = new Set<number>()
  const names = new Set<string>()
  for (const priority of target) {
    if (priority.itemId !== undefined) ids.add(priority.itemId)
    const name = nameKey(priority.item)
    if (name !== '') names.add(name)
  }
  return (source) => (source.itemId !== undefined && ids.has(source.itemId)) || (nameKey(source.item) !== '' && names.has(nameKey(source.item)))
}

// The filters of the Carry over dialog, like the ones of the priority list: a search for the item, the dungeon and boss or a player, a dungeon or one boss of it
// (an encounter scope, see encounterOptions in groupPriorities.ts) and an item slot (one of slotChoices). They only decide what the dialog shows: the items already
// ticked stay ticked when a filter hides them, and are carried over with the rest.
export type CarryFilters = { text: string; encounter: string; slot: string }
export const noCarryFilters: CarryFilters = { text: '', encounter: '', slot: '' }
export const carryFiltersActive = (filters: CarryFilters) => filters.text.trim() !== '' || filters.encounter !== '' || filters.slot !== ''

// The priorities the filters let through. slotOf gives the slot choice of a priority, or undefined while its item has not been looked up yet (it then matches no slot
// until it has been).
export function visibleForCarryOver<T extends { item: string; encounter: string; rankedPlayers: string[] }>(priorities: readonly T[], filters: CarryFilters, slotOf: (priority: T) => string | undefined): T[] {
  const text = filters.text.trim().toLowerCase()
  return priorities.filter((priority) =>
    (!text || `${priority.item} ${priority.encounter} ${priority.rankedPlayers.join(' ')}`.toLowerCase().includes(text))
    && matchesEncounterScope(priority.encounter, filters.encounter)
    && (!filters.slot || slotOf(priority) === filters.slot))
}
