// Every zone the guild has, in one list: the zones of the built-in drop lists (they ship in the app and just show up), the zones leaders add in Settings (they are
// kept with the drop lists, see guildTables.ts, so a zone added once is there for loot and for raid scheduling alike) and the zones of the older raid zone list
// (the `raidZones` collection, still read and still editable). Settings lists them, the raid calendar offers the raids among them, and the colors are kept per zone
// by key (zoneColors.ts). Only types are imported from other files, so Node runs the tests directly.
import { mergeTables, type LootTableDoc, type MergedZone, type ZoneKind } from './guildTables.ts'
import type { LootTableCapture } from './lootTables.ts'
import { catalogZoneKey } from './zoneColors.ts'

/** A zone of the older raid zone list, as `raidZones` keeps it. */
export type CatalogZone = { id: string; name: string; size: number }

export type ListedZone = {
  key: string // the key its color is kept under
  source: 'built-in' | 'guild' | 'catalog'
  name: string
  kind: ZoneKind
  players: number
  zoneId?: number // the zone number of a built-in zone or one made in Settings
  catalogId?: string // the id of a zone of the older raid zone list
  zone?: MergedZone // the zone as the drop lists have it in the phase it is written in (what the builders that rename or resize a zone take)
}

const byName = (a: { name: string; key: string }, b: { name: string; key: string }) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)

/**
 * Every zone, by name. The drop list zones come from the merge of every phase (a zone exists from the phase it was made in), seen at the current phase, and at the
 * next one for a zone that was made there (so a zone made for the next phase is listed too). A zone of the older list that has no counterpart is a raid of its size.
 */
export function listZones(captures: LootTableCapture[], docs: LootTableDoc[], catalog: readonly CatalogZone[], currentPhase: number): ListedZone[] {
  const seen = new Map<number, MergedZone>()
  for (const phase of [currentPhase, currentPhase + 1]) for (const zone of mergeTables(captures, docs, phase, true)) if (!seen.has(zone.zoneId)) seen.set(zone.zoneId, zone)
  const fromDropLists = [...seen.values()].map((zone): ListedZone => ({
    key: String(zone.zoneId), source: zone.custom ? 'guild' : 'built-in', name: zone.name, kind: zone.kind, players: zone.players, zoneId: zone.zoneId, zone,
  }))
  const older = catalog.map((entry): ListedZone => ({ key: catalogZoneKey(entry.id), source: 'catalog', name: entry.name, kind: 'raid', players: entry.size, catalogId: entry.id }))
  return [...fromDropLists, ...older].sort(byName)
}

export type RaidSizeNo = 10 | 20 | 40
/** The most characters of a zone's name a raid keeps (the raid rules stop at 80); a zone made in Settings has at most as many, and a longer one made before is cut. */
export const RAID_ZONE_NAME_MAX = 80
export type SchedulableZone = { id: string; name: string; size: RaidSizeNo }
const raidSizes: readonly number[] = [10, 20, 40]

/** The zones a raid can be scheduled in: every raid of 10, 20 or 40, whichever list it is from (the id of one made in Settings or built in is z and its number). */
export function schedulableZones(zones: readonly ListedZone[]): SchedulableZone[] {
  return zones.flatMap((zone) => (zone.kind === 'raid' && raidSizes.includes(zone.players) ? [{ id: zone.zoneId !== undefined ? `z${zone.zoneId}` : zone.catalogId ?? zone.key, name: zone.name.trim().slice(0, RAID_ZONE_NAME_MAX), size: zone.players as RaidSizeNo }] : []))
}

/** The key a name is compared by when looking for a zone that is there already. */
export const zoneNameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()
