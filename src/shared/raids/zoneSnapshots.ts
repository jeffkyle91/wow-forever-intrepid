import type { RaidZoneRecord } from '../../guildApi'

export function sameRaidZones(a: RaidZoneRecord[], b: RaidZoneRecord[]): boolean {
  // Firestore map key order is not significant; audit entries must list only actual value changes.
  return a.length === b.length && a.every((zone, index) => zone.id === b[index].id && zone.name === b[index].name && zone.size === b[index].size)
}
