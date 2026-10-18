// Loot table capture files: for one dungeon or raid, which creatures drop which items. A capture holds item ids and creature
// names only. Item names, icons and tooltips are fetched live by item id. See data/loot/ and scripts/check-loot.mjs.
// This file has no imports so Node can run it directly (the check script and the unit tests do).

export type LootSourceKind = 'boss' | 'rare' | 'trash'
export const lootSourceKinds: LootSourceKind[] = ['boss', 'rare', 'trash']

export type LootSource = { npcId: number; name: string; kind: LootSourceKind; itemIds: number[] }
export type LootTableCapture = {
  format: 1
  zoneId: number
  name: string
  kind: 'dungeon' | 'raid'
  players: number
  source: string
  capturedAt: string
  dataStatus?: string
  notes?: string[]
  sources: LootSource[]
  // Items that drop from any creature in the zone and have no single source.
  zoneWideItemIds: number[]
  // No longer read. A phase starts with no zones and the guild ticks the zones it has (see guildTables.ts); the checker still accepts the field.
  fromPhase?: number
  // Set by the app when it merges the guild's own tables with a capture (see guildTables.ts); a capture file has neither.
  custom?: boolean // a zone the guild made
  edited?: boolean // the guild changed something in this zone
}

const isId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0
const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max

// Checks the shape of a capture and returns every problem it finds, so a person can fix them in one pass.
export function checkLootCapture(data: unknown): { ok: true; table: LootTableCapture } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const record = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  if (typeof data !== 'object' || data === null) return { ok: false, errors: ['The file must contain one JSON object.'] }
  if (record.format !== 1) errors.push('format must be 1.')
  if (!isId(record.zoneId)) errors.push('zoneId must be a positive whole number.')
  if (!isText(record.name, 100)) errors.push('name must be text of at most 100 characters.')
  if (record.kind !== 'dungeon' && record.kind !== 'raid') errors.push('kind must be "dungeon" or "raid".')
  if (!isId(record.players) || (record.players as number) > 40) errors.push('players must be a whole number from 1 to 40.')
  if (!isText(record.source, 300)) errors.push('source must be text (the page the capture was read from).')
  if (typeof record.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.capturedAt)) errors.push('capturedAt must be a date like 2026-10-16.')
  if (record.notes !== undefined && (!Array.isArray(record.notes) || record.notes.some((note) => !isText(note, 500)))) errors.push('notes must be a list of short texts.')
  if (record.fromPhase !== undefined && !(typeof record.fromPhase === 'number' && Number.isInteger(record.fromPhase) && record.fromPhase >= 0 && record.fromPhase <= 31)) errors.push('fromPhase must be a whole number from 0 to 31.')

  const seen = new Map<number, string>()
  const note = (id: number, where: string) => {
    const earlier = seen.get(id)
    if (earlier) errors.push(`item ${id} appears in ${earlier} and in ${where}.`)
    else seen.set(id, where)
  }
  if (!Array.isArray(record.sources)) errors.push('sources must be a list.')
  else record.sources.forEach((entry, index) => {
    const source = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>
    const where = `source ${index + 1}${isText(source.name, 100) ? ` (${source.name})` : ''}`
    if (!isId(source.npcId)) errors.push(`${where}: npcId must be a positive whole number.`)
    if (!isText(source.name, 100)) errors.push(`${where}: name must be text.`)
    if (!lootSourceKinds.includes(source.kind as LootSourceKind)) errors.push(`${where}: kind must be boss, rare or trash.`)
    if (!Array.isArray(source.itemIds) || source.itemIds.length === 0 || source.itemIds.some((id) => !isId(id))) errors.push(`${where}: itemIds must be a non-empty list of item ids.`)
    else source.itemIds.forEach((id) => note(id as number, where))
  })
  if (!Array.isArray(record.zoneWideItemIds) || record.zoneWideItemIds.some((id) => !isId(id))) errors.push('zoneWideItemIds must be a list of item ids (it may be empty).')
  else record.zoneWideItemIds.forEach((id) => note(id as number, 'zoneWideItemIds'))

  return errors.length ? { ok: false, errors } : { ok: true, table: data as LootTableCapture }
}

// Every distinct item id in a capture, in the order they appear.
export function lootCaptureItemIds(table: LootTableCapture): number[] {
  return [...new Set([...table.sources.flatMap((source) => source.itemIds), ...table.zoneWideItemIds])]
}

// The creature (boss, rare or trash) that drops an item, or undefined for a zone-wide drop or an item not in the capture.
export function lootSourceOfItem(table: LootTableCapture, itemId: number): LootSource | undefined {
  return table.sources.find((source) => source.itemIds.includes(itemId))
}

// The item ids of one creature, found by the NPC id that the game puts in the corpse's GUID.
export function lootItemsOfNpc(table: LootTableCapture, npcId: number): number[] {
  return table.sources.find((source) => source.npcId === npcId)?.itemIds ?? []
}
