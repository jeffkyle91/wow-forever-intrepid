import type { PlayerRecord as Player } from '../../guildApi'
import { nameKey } from './completion'

// Loot priorities and awards store character names as typed, not roster ids. This finds the class of a name that is on
// the roster (first name, or first name and surname); a name that is not on the roster has no class.
export function classLookup(roster: Player[]) {
  const classes = new Map<string, string>()
  for (const player of roster) {
    classes.set(nameKey(player.name), player.className)
    if (player.surname) classes.set(nameKey(`${player.name} ${player.surname}`), player.className)
  }
  return (name: string) => classes.get(nameKey(name))
}
