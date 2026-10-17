// The item slots of the Loot priorities filter, and which one an item falls in. No imports, so Node can run it in the unit tests.
export const slotChoices = [
  'Tier Token', 'Head', 'Neck', 'Shoulder', 'Back', 'Chest', 'Wrist', 'Hands', 'Waist', 'Legs', 'Feet', 'Finger', 'Trinket',
  '1H Weapon', '2H Weapon', 'Off-Hand', 'Ranged', 'Relic', 'Other',
] as const

// The tooltip's own word for the slot (see itemSlotLabel in shared/game/itemTooltip.ts) to the filter's choice.
const byLabel: Record<string, string> = {
  head: 'Head', neck: 'Neck', shoulder: 'Shoulder', back: 'Back', chest: 'Chest', robe: 'Chest', wrist: 'Wrist', hands: 'Hands', waist: 'Waist',
  legs: 'Legs', feet: 'Feet', finger: 'Finger', trinket: 'Trinket', 'one-hand': '1H Weapon', 'main hand': '1H Weapon', 'two-hand': '2H Weapon',
  'off hand': 'Off-Hand', 'held in off-hand': 'Off-Hand', ranged: 'Ranged', thrown: 'Ranged', relic: 'Relic',
}

// An item with no slot of its own is a Tier Token when its name says "token" (a guess, to be checked when raids unlock and tier
// tokens exist), and Other otherwise (bags, recipes, mounts, keys).
export function slotCategory(label: string | undefined, itemName: string): string {
  if (label) return byLabel[label.trim().toLowerCase()] ?? 'Other'
  return /\btoken\b/i.test(itemName) ? 'Tier Token' : 'Other'
}
