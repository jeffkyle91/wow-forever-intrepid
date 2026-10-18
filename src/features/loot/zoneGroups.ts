// How the zone checklist of the drop list editor is laid out: dungeons first, then raids by size (10-man, 20-man, 40-man, and any other size a zone the
// guild made has). A kind of zone nobody has is not there, so a guild with no raids sees no raid groups. Pure functions with no imports, so Node runs their
// tests directly (tests/unit/zone-groups.test.ts).
export type Groupable = { kind: string; players: number }
export type ZoneGroup<T extends Groupable> = { key: string; label: string; zones: T[] }

/** The zones in groups, in the order they were given inside each group: dungeons, then raids from the smallest size up. Empty groups are left out. */
export function groupZones<T extends Groupable>(zones: readonly T[]): ZoneGroup<T>[] {
  const groups = new Map<string, { sort: number; group: ZoneGroup<T> }>()
  for (const zone of zones) {
    const raid = zone.kind === 'raid'
    const size = Number.isFinite(zone.players) ? zone.players : 0
    const key = raid ? `raid-${size}` : 'dungeon'
    const entry = groups.get(key) ?? { sort: raid ? size : -1, group: { key, label: raid ? `${size}-man raids` : 'Dungeons', zones: [] } }
    entry.group.zones.push(zone)
    groups.set(key, entry)
  }
  return [...groups.values()].sort((a, b) => a.sort - b.sort).map((entry) => entry.group)
}

/** The groups to show open at first: the only group, every group that has a zone in the lists, and when none has one, the first. */
export function openGroupKeys<T extends Groupable>(groups: readonly ZoneGroup<T>[], inLists: (zone: T) => boolean): Set<string> {
  const open = new Set(groups.filter((group) => groups.length === 1 || group.zones.some(inLists)).map((group) => group.key))
  if (open.size === 0 && groups.length > 0) open.add(groups[0].key)
  return open
}

/** Whether the Zones section starts open: when the phase has no zone in its lists and follows nothing, there is something to set up. */
export const zonesStartOpen = (zonesInLists: number, follows: boolean) => zonesInLists === 0 && !follows
