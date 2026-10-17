// Which creatures and items of a loot table match the search text. No imports, so Node can run it in the unit tests.
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
  const groups: LootGroup[] = table.sources.map((source) => ({
    key: `npc-${source.npcId}`, name: source.name, kind: source.kind as LootGroup['kind'], npcId: source.npcId,
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

export const dropPriorityId = (itemId: number) => `drop-${itemId}`

// The encounter text follows the "dungeon \u00b7 boss" form that priorities typed by hand use.
export const dropEncounter = (zoneName: string, group: { kind: string; name: string }) => `${zoneName} \u00b7 ${group.kind === 'zone' ? 'any creature' : group.name}`

export function dropPriorityRecord(pick: DropPick, itemName: string) {
  return {
    item: itemName, encounter: pick.encounter, rankedPlayers: [] as string[], councilNote: '',
    itemId: pick.itemId, zoneId: pick.zoneId, ...(pick.npcId !== undefined ? { npcId: pick.npcId } : {}),
  }
}
