import { useMemo, type CSSProperties } from 'react'
import { TABLE_PHASE_MAX, type LootTableDoc } from '../../shared/game/guildTables'
import { zoneColor } from '../../shared/game/zoneColors'
import { splitEncounter } from './groupPriorities'
import { useMergedTables } from './useDropTables'

// The color of a zone in the loot pages (shared/game/zoneColors.ts has the colors). A priority knows its zone by number when it came from Browse drops; one typed
// by hand, or from before that, names its dungeon in its encounter ("Dungeon · Boss"), so the zone is found by that name among the zones of every phase.
const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

export type ZoneColors = {
  /** The color of a zone by its number. */
  ofZone: (zoneId: number) => string
  /** The color of the zone with this name, in any phase, when the guild has one. */
  ofName: (name: string) => string | undefined
  /** The color of the zone a priority is for: by its zone number, else by the dungeon its encounter names. Nothing for one that names no zone. */
  ofPriority: (priority: { zoneId?: number; encounter: string }) => string | undefined
}

export function useZoneColors(lootTables: LootTableDoc[], overrides?: Readonly<Record<string, unknown>>): ZoneColors {
  const zones = useMergedTables(lootTables, TABLE_PHASE_MAX, true)
  return useMemo(() => {
    const byName = new Map<string, number>()
    for (const zone of zones) if (!byName.has(nameKey(zone.name))) byName.set(nameKey(zone.name), zone.zoneId)
    const ofZone = (zoneId: number) => zoneColor(zoneId, overrides)
    const ofName = (name: string) => { const id = byName.get(nameKey(name)); return id === undefined ? undefined : ofZone(id) }
    return { ofZone, ofName, ofPriority: (priority) => (priority.zoneId !== undefined ? ofZone(priority.zoneId) : ofName(splitEncounter(priority.encounter).dungeon)) }
  }, [zones, overrides])
}

/** The inline style that hands a color to the stylesheet (nothing when there is none). */
export const zoneStyle = (color: string | undefined): CSSProperties | undefined => (color ? ({ '--zone-color': color } as CSSProperties) : undefined)
