import { imageOfZone, type ZoneArt, type ZoneImage } from '../game/zoneArt.ts'
import { catalogZoneKey, isZoneKey, zoneColor } from '../game/zoneColors.ts'

// The picture and color of a zone of a scheduled raid (RAID-016). A raid keeps only a snapshot of each zone ({ id, name, size }), so its picture is found from the id,
// live, in the zone art the guild keeps: a renamed zone keeps its picture, and a leader changing the picture changes every banner. Pure, so Node tests it.

const NUMBERED = /^z([0-9]{1,9})$/

/**
 * The key a raid's zone is known by in the zone art and zone colors. A raid zone id is `z<zone number>` for a built-in or guild zone (the number, without leading zeros,
 * as the art keeps it) or the id of an older raid zone, which is kept as `r-<id>`. Any other id has no key (the rules let a raid zone id be any text of 1 to 100 characters,
 * so this never assumes it is a safe one).
 */
export function raidZoneKey(zoneId: string): string | undefined {
  const numbered = NUMBERED.exec(zoneId)
  if (numbered) return String(Number(numbered[1]))
  const key = catalogZoneKey(zoneId)
  return isZoneKey(key) ? key : undefined
}

/** The picture of a raid's zone, if it has one. */
export function raidZoneImage(zoneArt: ZoneArt, zoneId: string): ZoneImage | undefined {
  const key = raidZoneKey(zoneId)
  return key === undefined ? undefined : imageOfZone(zoneArt, key)
}

/** The color of a raid's zone: the guild's choice, else the automatic one; a zone with no key gets the neutral slate. */
export function raidZoneColor(zoneId: string, overrides?: Readonly<Record<string, unknown>>): string {
  return zoneColor(raidZoneKey(zoneId) ?? '', overrides)
}
