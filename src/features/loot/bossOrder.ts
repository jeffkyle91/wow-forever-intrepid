import type { LootTableCapture } from '../../shared/game/lootTables'

// The creatures of a dungeon in encounter order, as the drop list gives them (bosses first, in the order they are met), by the dungeon's name.
// A dungeon that has no drop list has no order. `useBossOrder` (useDropTables.ts) builds it from the lists as they stand, the guild's own included.
const normal = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase()

export function bossOrderOf(tables: LootTableCapture[]): (dungeon: string) => string[] {
  return (dungeon) => {
    const table = tables.find((candidate) => normal(candidate.name) === normal(dungeon))
    return table ? table.sources.map((source) => source.name) : []
  }
}
