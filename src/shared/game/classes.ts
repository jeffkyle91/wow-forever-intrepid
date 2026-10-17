export type Role = 'Tank' | 'Healer' | 'Melee' | 'Ranged'

export type SpecializationOption = { name: string; role: Role }

export function classColorKey(className: string) {
  return className.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// The classes that give a block (not a table row) the class stripe, fade and coloured name. See .class-accent in App.css.
export function classAccent(className: string) {
  return `class-accent class-color-${classColorKey(className)}`
}

export const classSpecializations: Record<string, SpecializationOption[]> = {
  Warrior: [
    { name: 'Arms', role: 'Melee' },
    { name: 'Fury', role: 'Melee' },
    { name: 'Protection', role: 'Tank' },
  ],
  Paladin: [
    { name: 'Holy', role: 'Healer' },
    { name: 'Protection', role: 'Tank' },
    { name: 'Retribution', role: 'Melee' },
  ],
  Hunter: [
    { name: 'Beast Mastery', role: 'Ranged' },
    { name: 'Marksmanship', role: 'Ranged' },
    { name: 'Survival', role: 'Ranged' },
  ],
  Rogue: [
    { name: 'Assassination', role: 'Melee' },
    { name: 'Combat', role: 'Melee' },
    { name: 'Subtlety', role: 'Melee' },
  ],
  Priest: [
    { name: 'Discipline', role: 'Healer' },
    { name: 'Holy', role: 'Healer' },
    { name: 'Shadow', role: 'Ranged' },
  ],
  Shaman: [
    { name: 'Elemental', role: 'Ranged' },
    { name: 'Enhancement', role: 'Melee' },
    { name: 'Restoration', role: 'Healer' },
  ],
  Mage: [
    { name: 'Arcane', role: 'Ranged' },
    { name: 'Fire', role: 'Ranged' },
    { name: 'Frost', role: 'Ranged' },
  ],
  Warlock: [
    { name: 'Affliction', role: 'Ranged' },
    { name: 'Demonology', role: 'Ranged' },
    { name: 'Destruction', role: 'Ranged' },
  ],
  Druid: [
    { name: 'Balance', role: 'Ranged' },
    { name: 'Feral', role: 'Melee' },
    { name: 'Guardian', role: 'Tank' },
    { name: 'Restoration', role: 'Healer' },
  ],
}

export const raidRoles: Role[] = ['Tank', 'Healer', 'Melee', 'Ranged']
