// Groups the priorities for display: by dungeon, then by boss. No imports, so Node can run it in the unit tests.
//
// A priority's `encounter` is written as the dungeon, a middle dot and the boss, both by hand and by Browse drops, so one rule groups both kinds. One without
// that form has no dungeon and goes in a last group of its own. A dungeon's bosses follow the order the drop list gives them
// (bossOrder, which is the encounter order of the dungeon); a boss it does not know comes after those, in the order they first appear.
// The creature "any creature" (items that drop from anything in the zone) comes last. Inside a boss the priorities keep the order given.
export type BossGroup<T> = { key: string; boss: string; priorities: T[] }
export type DungeonGroup<T> = { key: string; dungeon: string; count: number; bosses: BossGroup<T>[] }

const anyCreature = 'any creature'
const key = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase()

export function splitEncounter(encounter: string): { dungeon: string; boss: string } {
  const text = encounter.trim()
  const at = text.indexOf('\u00b7')
  if (at === -1) return { dungeon: '', boss: text }
  return { dungeon: text.slice(0, at).trim(), boss: text.slice(at + 1).trim() }
}

export function groupPriorities<T extends { encounter: string }>(priorities: T[], bossOrder: (dungeon: string) => string[] = () => []): DungeonGroup<T>[] {
  const dungeons = new Map<string, { dungeon: string; bosses: Map<string, BossGroup<T>> }>()
  for (const priority of priorities) {
    const { dungeon, boss } = splitEncounter(priority.encounter)
    const dungeonKey = key(dungeon)
    if (!dungeons.has(dungeonKey)) dungeons.set(dungeonKey, { dungeon, bosses: new Map() })
    const bosses = (dungeons.get(dungeonKey) as { bosses: Map<string, BossGroup<T>> }).bosses
    const bossKey = key(boss)
    if (!bosses.has(bossKey)) bosses.set(bossKey, { key: `${dungeonKey}|${bossKey}`, boss, priorities: [] })
    ;(bosses.get(bossKey) as BossGroup<T>).priorities.push(priority)
  }
  const groups = [...dungeons.entries()].map(([dungeonKey, { dungeon, bosses }]) => {
    const order = bossOrder(dungeon).map(key)
    const rank = (boss: BossGroup<T>) => (key(boss.boss) === anyCreature ? Number.MAX_SAFE_INTEGER : order.includes(key(boss.boss)) ? order.indexOf(key(boss.boss)) : order.length)
    const sortedBosses = [...bosses.values()].map((boss, index) => ({ boss, index })).sort((a, b) => rank(a.boss) - rank(b.boss) || a.index - b.index).map(({ boss }) => boss)
    return { key: dungeonKey, dungeon, count: sortedBosses.reduce((total, boss) => total + boss.priorities.length, 0), bosses: sortedBosses }
  })
  // Dungeons by name, and the ones with no dungeon last.
  return groups.sort((a, b) => (a.dungeon === '' ? 1 : 0) - (b.dungeon === '' ? 1 : 0) || a.dungeon.localeCompare(b.dungeon))
}

// The choices of the encounter filter: each dungeon, then its bosses below it, in the order the list is grouped. A choice is a scope: "d:" and
// the dungeon for a whole dungeon, "b:" and the dungeon and boss for one boss. The group with no dungeon is offered as "Other priorities".
export type EncounterOption = { value: string; label: string; level: 0 | 1 }

export function encounterOptions<T extends { encounter: string }>(priorities: T[], bossOrder: (dungeon: string) => string[] = () => []): EncounterOption[] {
  return groupPriorities(priorities, bossOrder).flatMap((group) => [
    { value: `d:${group.key}`, label: group.dungeon || 'Other priorities', level: 0 as const },
    ...group.bosses.map((boss) => ({ value: `b:${boss.key}`, label: boss.boss || 'No encounter noted', level: 1 as const })),
  ])
}

// Whether an encounter text is in a scope. An empty scope is everything; a scope this does not understand is nothing.
export function matchesEncounterScope(encounter: string, scope: string): boolean {
  if (!scope) return true
  const { dungeon, boss } = splitEncounter(encounter)
  if (scope.startsWith('d:')) return key(dungeon) === scope.slice(2)
  if (scope.startsWith('b:')) return `${key(dungeon)}|${key(boss)}` === scope.slice(2)
  return false
}
