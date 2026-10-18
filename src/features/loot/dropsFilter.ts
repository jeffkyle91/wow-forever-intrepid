// Which creatures and items of a loot table match the search text, and what a drop has to do with the priorities. Node runs it in the unit tests.
import { nameKey } from './completion.ts'

type TableLike = { sources: { npcId: number; name: string; kind: string; itemIds: number[] }[]; zoneWideItemIds: number[] }

export type LootGroup = { key: string; name: string; kind: 'boss' | 'rare' | 'trash' | 'zone'; npcId?: number; itemIds: number[] }

export const zoneWideName = 'Any creature in the zone'
export const kindLabels: Record<LootGroup['kind'], string> = { boss: 'Boss', rare: 'Rare', trash: 'Trash', zone: 'Zone-wide' }

// The creatures of a table, then the zone-wide items as one last group. A creature matches on its name or kind and then shows all
// its items; otherwise it shows only the items that match, by id or by name (nameOf gives a name once it has been looked up).
// Groups with nothing to show are left out.
export function filterGroups(table: TableLike, query: string, nameOf: (itemId: number) => string | undefined): LootGroup[] {
  const text = query.trim().toLowerCase()
  const itemMatches = (id: number) => String(id).includes(text) || (nameOf(id) ?? '').toLowerCase().includes(text)
  // A creature the guild added has no game number when it is not known: the merged table says 0, which is no number (it gets its own key and no id).
  const groups: LootGroup[] = table.sources.map((source, index) => ({
    key: source.npcId > 0 ? `npc-${source.npcId}` : `creature-${index}`, name: source.name, kind: source.kind as LootGroup['kind'], ...(source.npcId > 0 ? { npcId: source.npcId } : {}),
    itemIds: !text || source.name.toLowerCase().includes(text) || source.kind.includes(text) ? source.itemIds : source.itemIds.filter(itemMatches),
  }))
  groups.push({ key: 'zone-wide', name: zoneWideName, kind: 'zone', itemIds: !text || zoneWideName.toLowerCase().includes(text) ? table.zoneWideItemIds : table.zoneWideItemIds.filter(itemMatches) })
  return groups.filter((group) => group.itemIds.length > 0)
}

export const countItems = (groups: LootGroup[]) => groups.reduce((total, group) => total + group.itemIds.length, 0)

// Making a priority from an item that was ticked in Browse drops. The id is fixed per item, so there is one priority per item for the
// whole guild. The record has no field that is undefined (Firestore refuses one): npcId is left out for an item that drops from any
// creature in the zone. The candidate list starts empty, so the priority shows as "Needs players".
export type DropPick = { itemId: number; zoneId: number; npcId?: number; encounter: string }


// The encounter text follows the "dungeon \u00b7 boss" form that priorities typed by hand use.
export const dropEncounter = (zoneName: string, group: { kind: string; name: string }) => `${zoneName} \u00b7 ${group.kind === 'zone' ? 'any creature' : group.name}`

export function dropPriorityRecord(pick: DropPick, itemName: string, phaseNo = 0) {
  return {
    item: itemName, encounter: pick.encounter, rankedPlayers: [] as string[], councilNote: '',
    itemId: pick.itemId, zoneId: pick.zoneId, ...(pick.npcId !== undefined ? { npcId: pick.npcId } : {}), phaseNo,
  }
}

// The priorities that stand for an item: those that carry its id, and, for one typed by hand, those with the same name. An item is "on the
// list" when this is not empty; removing it from the list removes all of them. The name may be unknown (not looked up yet): then only the id counts.
export function prioritiesForItem<T extends { item: string; itemId?: number }>(priorities: T[], itemId: number, itemName?: string): T[] {
  const name = itemName ? nameKey(itemName) : ''
  return priorities.filter((priority) => priority.itemId === itemId || (name !== '' && nameKey(priority.item) === name))
}
