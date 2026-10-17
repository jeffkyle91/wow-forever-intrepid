import { dropTables } from './dropTables'

// The creatures of a dungeon in encounter order, as the drop list gives them (bosses first, in the order they are met), by the
// dungeon's name. A dungeon that has no drop list has no order.
const normal = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase()

export function bossOrder(dungeon: string): string[] {
  const table = dropTables.find((candidate) => normal(candidate.name) === normal(dungeon))
  return table ? table.sources.map((source) => source.name) : []
}
