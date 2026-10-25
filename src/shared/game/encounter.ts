// Reading the place of a drop. A priority's or an award's `encounter` is the dungeon, a middle dot and the boss ("The Deadmines · Edwin VanCleef"). An award recorded with a
// dungeon and no boss is "The Deadmines ·": it keeps the separator so the Log's dungeon filter still reads it as a dungeon (see encounterOf in features/loot/manualAward.ts).
// No imports, so Node tests it.

/** The encounter as a person reads it: a separator with no boss after it is dropped. */
export function encounterLabel(encounter: string): string {
  return encounter.replace(/\s*·\s*$/, '').trim()
}
