export type SortKey = 'default' | 'name' | 'class' | 'specialization' | 'role' | 'team' | 'raiderType' | 'access' | 'publicComment' | 'leadershipComment'
export type SortDirection = 'asc' | 'desc'

type PlayerLike = { id: string; name: string; surname?: string; className: string; specialization?: string; role: string; linkedUid?: string }
type SortValues<T> = (player: T, key: SortKey) => string | undefined

export function sortRoster<T extends PlayerLike>(players: T[], key: SortKey, direction: SortDirection, teamOf: (playerId: string) => string | undefined, teamOrder: string[], extraValue?: SortValues<T>): T[] {
  if (key === 'default') return players
  const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
  const byName = (a: T, b: T) => text(a.name, b.name) || text(a.surname ?? '', b.surname ?? '') || a.id.localeCompare(b.id)
  const value = (player: T): string | undefined => {
    if (extraValue) return extraValue(player, key)
    if (key === 'name') return player.name
    if (key === 'class') return player.className
    if (key === 'specialization') return player.specialization
    if (key === 'role') return player.role
    if (key === 'team') {
      const team = teamOf(player.id)
      return team && teamOrder.includes(team) ? team : undefined
    }
    if (key === 'access') return player.linkedUid ? 'Linked' : 'No account'
    return undefined
  }
  const sign = direction === 'asc' ? 1 : -1
  return [...players].sort((a, b) => {
    if (key === 'name') return sign * byName(a, b)
    const first = value(a)
    const second = value(b)
    if (!first && second) return 1
    if (first && !second) return -1
    return sign * text(first ?? '', second ?? '') || byName(a, b)
  })
}
