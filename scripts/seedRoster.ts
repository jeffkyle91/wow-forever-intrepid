// Invented roster for the local emulator only: every spec of every class once (28), plus extras, 40 players in four 10-player teams.
// Blue, Yellow, Red and White are arranged so the buff and debuff checklist shows different results:
// Blue has a Warrior and a Rogue, Yellow Warriors only (Sunder Armor), Red Rogues only (Expose Armor), White neither (armor reduction missing).
export type SeedPlayer = { name: string; className: string; specialization: string; team: 'blue' | 'yellow' | 'red' | 'white' }

export const seedRoster: SeedPlayer[] = [
  // The first four keep the original seed's ids (player-1 to player-4) and names.
  { name: 'Aldric', className: 'Warrior', specialization: 'Protection', team: 'blue' },
  { name: 'Brienne', className: 'Priest', specialization: 'Holy', team: 'blue' },
  { name: 'Cormac', className: 'Mage', specialization: 'Fire', team: 'blue' },
  { name: 'Delia', className: 'Rogue', specialization: 'Combat', team: 'blue' },
  { name: 'Edric', className: 'Paladin', specialization: 'Retribution', team: 'blue' },
  { name: 'Fenna', className: 'Shaman', specialization: 'Enhancement', team: 'blue' },
  { name: 'Garrick', className: 'Hunter', specialization: 'Marksmanship', team: 'blue' },
  { name: 'Halwen', className: 'Druid', specialization: 'Feral', team: 'blue' },
  { name: 'Isolde', className: 'Warlock', specialization: 'Affliction', team: 'blue' },
  { name: 'Joren', className: 'Shaman', specialization: 'Restoration', team: 'blue' },

  { name: 'Kestrel', className: 'Warrior', specialization: 'Fury', team: 'yellow' },
  { name: 'Lorcan', className: 'Warrior', specialization: 'Arms', team: 'yellow' },
  { name: 'Mirela', className: 'Priest', specialization: 'Discipline', team: 'yellow' },
  { name: 'Neven', className: 'Mage', specialization: 'Frost', team: 'yellow' },
  { name: 'Oriel', className: 'Paladin', specialization: 'Holy', team: 'yellow' },
  { name: 'Perrin', className: 'Shaman', specialization: 'Elemental', team: 'yellow' },
  { name: 'Quilla', className: 'Hunter', specialization: 'Beast Mastery', team: 'yellow' },
  { name: 'Rowan', className: 'Druid', specialization: 'Balance', team: 'yellow' },
  { name: 'Selene', className: 'Warlock', specialization: 'Demonology', team: 'yellow' },
  { name: 'Tamsin', className: 'Druid', specialization: 'Restoration', team: 'yellow' },

  { name: 'Ulric', className: 'Rogue', specialization: 'Assassination', team: 'red' },
  { name: 'Vesper', className: 'Rogue', specialization: 'Subtlety', team: 'red' },
  { name: 'Wynne', className: 'Priest', specialization: 'Shadow', team: 'red' },
  { name: 'Xander', className: 'Mage', specialization: 'Arcane', team: 'red' },
  { name: 'Yara', className: 'Paladin', specialization: 'Protection', team: 'red' },
  { name: 'Zephyr', className: 'Hunter', specialization: 'Survival', team: 'red' },
  { name: 'Anselm', className: 'Druid', specialization: 'Guardian', team: 'red' },
  { name: 'Bryn', className: 'Warlock', specialization: 'Destruction', team: 'red' },
  { name: 'Corwin', className: 'Shaman', specialization: 'Enhancement', team: 'red' },
  { name: 'Dara', className: 'Paladin', specialization: 'Retribution', team: 'red' },

  { name: 'Elric', className: 'Priest', specialization: 'Shadow', team: 'white' },
  { name: 'Faye', className: 'Priest', specialization: 'Holy', team: 'white' },
  { name: 'Gwyn', className: 'Mage', specialization: 'Frost', team: 'white' },
  { name: 'Hale', className: 'Mage', specialization: 'Arcane', team: 'white' },
  { name: 'Ivor', className: 'Paladin', specialization: 'Retribution', team: 'white' },
  { name: 'Jessa', className: 'Paladin', specialization: 'Holy', team: 'white' },
  { name: 'Kell', className: 'Hunter', specialization: 'Marksmanship', team: 'white' },
  { name: 'Lyra', className: 'Hunter', specialization: 'Beast Mastery', team: 'white' },
  { name: 'Marek', className: 'Shaman', specialization: 'Enhancement', team: 'white' },
  { name: 'Nessa', className: 'Shaman', specialization: 'Restoration', team: 'white' },
]
