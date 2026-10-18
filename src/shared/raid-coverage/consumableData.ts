import type { ConsumableAlternative } from './types.ts'

// Consumables that can stand in, usually more weakly, for a class buff. See "Consumable alternatives" in README.md.
//
// Empty on purpose: no consumable has been verified from a WoW Forever source yet. Drums of Kings and similar items are NOT assumed
// to exist or to work like another version of the game. Add an entry only with a Forever source and the effect text copied from it.
// A planned consumable never counts as class coverage; it only recolours the icon gold once an organizer marks it planned.
export const consumableAlternatives: ConsumableAlternative[] = []
