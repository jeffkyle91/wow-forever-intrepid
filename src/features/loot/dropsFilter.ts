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
