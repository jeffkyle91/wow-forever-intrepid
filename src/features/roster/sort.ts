// Sorting for the Guild roster tab. A pure function with no imports, so Node can run it in the unit tests.
export type SortKey = 'default' | 'name' | 'class' | 'role' | 'team'
export type SortDirection = 'asc' | 'desc'
export const sortKeys: { id: SortKey; label: string }[] = [
  { id: 'default', label: 'Default order' },
  { id: 'name', label: 'Name' },
  { id: 'class', label: 'Class' },
  { id: 'role', label: 'Role' },
  { id: 'team', label: 'Team' },
]

type PlayerLike = { id: string; name: string; surname?: string; className: string; role: string }
const roleOrder = ['Tank', 'Healer', 'Melee', 'Ranged']

// Orders characters by name, class, role (Tank, Healer, Melee, Ranged) or team (in the order of `teamOrder`, characters with no
// team last when ascending). Ties always break by name, so the order is stable. 'default' returns the list untouched. The input
// is never changed. Alts are placed under their main afterwards by groupAlts, so only the mains' order matters on screen.
export function sortRoster<T extends PlayerLike>(players: T[], key: SortKey, direction: SortDirection, teamOf: (playerId: string) => string | undefined, teamOrder: string[]): T[] {
  if (key === 'default') return players
  const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
  const byName = (a: T, b: T) => text(a.name, b.name) || text(a.surname ?? '', b.surname ?? '') || a.id.localeCompare(b.id)
  const rank = (order: string[], value: string | undefined) => {
    const index = value === undefined ? -1 : order.indexOf(value)
    return index === -1 ? order.length : index
  }
  const primary = (a: T, b: T) => {
    if (key === 'name') return byName(a, b)
    if (key === 'class') return text(a.className, b.className)
    if (key === 'role') return rank(roleOrder, a.role) - rank(roleOrder, b.role)
    return rank(teamOrder, teamOf(a.id)) - rank(teamOrder, teamOf(b.id))
  }
  const sign = direction === 'asc' ? 1 : -1
  return [...players].sort((a, b) => sign * primary(a, b) || byName(a, b))
}
