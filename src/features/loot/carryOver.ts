import { lineFields, readLines } from '../../shared/game/candidates.ts'
import { nameKey } from './completion.ts'

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
