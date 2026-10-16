import type { CoverageEffect } from './types.ts'

// The editable game-facts file. See README.md in this folder before changing it.
//
// Source: Wowhead WoW Forever class ability and talent pages, read on 2026-10-16, plus the Forever build article below.
// Nothing here has been checked in game or approved by the repository owner, so NO entry is `confirmed` and none has
// `verifiedOn`. The calculation engine only counts confirmed entries, so every requirement below shows as Unverified
// until an entry is checked in game and promoted (confidence and scopeStatus 'confirmed', plus a verifiedOn date).
//
// - `provisional`: the current Forever tooltip states provider, scope and effect clearly.
// - `unverified`: ambiguous wording, an unknown talent or rune requirement, or conflicting information.
// - No `slot` is set anywhere. Shaman totem slots, Horn of Lordaeron, Mass Salvation and other exclusivity rules are unresolved.
//   Add a slot only when Forever evidence supports it.
// - A stackGroup is one requirement with alternative providers. A group cannot mix kinds, so a group that holds a targeted or
//   party effect uses the most cautious kind among its members ("targeted-buff", then "party-buff"). The effect's real scope is in its notes.
// - Rank spell IDs: `spellId` is the primary ID; the other ranks are listed in the notes.
// - `visibility: 'encounter'` keeps researched data (here the resistance auras, totems and Shadow Protection) out of the standard
//   checklist for possible future encounter-specific coverage. Omit it for everyday raid coverage.
// - `visibility: 'excluded'` keeps an effect in the catalog but out of the standard checklist by owner decision (Heart of the Lion,
//   Valor of Azeroth, Tremor Totem, Devotion Aura, Stoneskin Totem, Fear Ward, and the Paladin Judgements and Seals: Judgement of
//   Light and Judgement of Wisdom, which are the Seal of Light and Seal of Wisdom spells). Unlike resistance data it is not
//   encounter-specific. Only the excluded effect leaves a stackGroup: any remaining alternatives (Windwall Totem) stay as the
//   requirement, and a group with no active effect left disappears.
// - Spell icons are looked up by `spellId` in spellIcons.ts.
// - Talents and runes are not tracked, so a provider that needs one carries `talent` and can only ever be Potential once confirmed.
// - `specs` marks which roster specializations can hold that talent (from the talent tree on Wowhead). Other recognised specs are
//   ineligible. It never makes a talent provider guaranteed. "Guardian" is listed with Feral because the roster splits the Feral Combat
//   tree into Feral and Guardian; that mapping is unchecked. Baseline abilities have no `specs`: Wowhead's skill line is not a spec requirement.
// - `assumed` is an explicit raid-planning assumption for named specs of one talent provider: those players count as providers in
//   the estimate only (Estimated Available), never in the verified result, and it is never applied to other talents of that spec.
//   Enabled only where the research records the talent tree: Leader of the Pack (Feral) and Moonkin Form (Balance). Not enabled:
//   Trueshot Aura (Marksmanship tree is only inferred), Guardian for Leader of the Pack, Mana Tide Totem (unverified), or any rune.

const spell = (id: number) => `https://www.wowhead.com/forever/spell=${id}`
const buildArticle = 'https://www.wowhead.com/forever/news/many-buffs-now-raid-wide-class-changes-in-latest-wow-forever-build-383456'

const provisional = { confidence: 'provisional', scopeStatus: 'provisional' } as const
const unverified = { confidence: 'unverified', scopeStatus: 'unknown' } as const

export const coverageEffects: CoverageEffect[] = [
  // Melee attack power from the Warrior shout
  { id: 'battle-shout', name: 'Battle Shout', kind: 'raid-buff', category: 'attack power', spellId: 5242, providers: [{ className: 'Warrior' }], ...provisional,
    sources: [spell(5242), buildArticle], notes: 'Melee attack power, 3 min, within 20 yards. Raid-wide per the latest build article. Ranks: 5242, 6192, 6673, 11549, 11550, 11551, 25289.' },

  // Melee attack power from Paladin
  { id: 'blessing-of-might', name: 'Blessing of Might', kind: 'targeted-buff', stackGroup: 'melee-attack-power', category: 'attack power', spellId: 19740, providers: [{ className: 'Paladin' }], ...provisional,
    sources: [spell(19740)], notes: 'Targeted; the Greater version covers same-class members. Ranks 19740 to 25291 (7 ranks); Greater 25782, 25916. Tooltip: one Blessing per Paladin on a player.' },
  { id: 'horn-of-lordaeron', name: 'Horn of Lordaeron', kind: 'targeted-buff', stackGroup: 'melee-attack-power', category: 'attack power', spellId: 425600, providers: [{ className: 'Paladin' }], ...provisional,
    sources: [spell(425600)], notes: 'Real scope is party, 30 yards, strength and agility, 2 min. Listed as targeted-buff only because it shares a requirement with Blessing of Might. Tooltip: "Exclusive with Blessing of Might." Interaction with Might and slot behaviour unresolved.' },

  // Auras and talent-based raid buffs
  { id: 'trueshot-aura', name: 'Trueshot Aura', kind: 'raid-buff', category: 'attack power', spellId: 1299346, providers: [{ className: 'Hunter', specs: ['Marksmanship'], talent: 'Trueshot Aura (Marksmanship tree, inferred)' }], ...provisional,
    sources: [spell(1299346), buildArticle], notes: 'Ranged attack power, 45 yards, party or raid per the build article. Rank IDs and values conflict: 1299346, 1299348, 19506, 20905, 20906. Do not assert a rank. Talent tree is inferred.' },
  { id: 'leader-of-the-pack', name: 'Leader of the Pack', kind: 'raid-buff', category: 'critical strike', spellId: 17007, providers: [{ className: 'Druid', specs: ['Feral', 'Guardian'], talent: 'Leader of the Pack (Feral Combat tree)', assumed: { specs: ['Feral'], basis: 'Wowhead Forever lists Leader of the Pack in the Feral Combat tree (research E76) and the roster calls that spec Feral. Guardian is not assumed: no evidence it holds this talent. Needs Cat or Bear form.' } }], ...provisional,
    sources: [spell(17007), buildArticle], notes: '+3% melee and ranged crit, 45 yards, party or raid per the build article. Needs Cat, Bear or Dire Bear form, which is not tracked. The older exclusivity with Moonkin Form was removed in the latest build.' },
  { id: 'moonkin-form', name: 'Moonkin Form', kind: 'raid-buff', category: 'critical strike', spellId: 24858, providers: [{ className: 'Druid', specs: ['Balance'], talent: 'Moonkin Form (Balance tree)', assumed: { specs: ['Balance'], basis: 'Wowhead Forever lists Moonkin Form in the Balance tree (research E75). Needs Moonkin form.' } }], ...provisional,
    sources: [spell(24858), buildArticle], notes: '+3% spell crit, 45 yards, party or raid per the build article. Needs Moonkin form, which is not tracked.' },
  { id: 'valor-of-azeroth', visibility: 'excluded', name: 'Valor of Azeroth', kind: 'raid-buff', category: 'attack power', spellId: 461475, providers: [{ className: 'Warrior' }], ...unverified,
    sources: [spell(461475)], notes: '+5% crit and +90 attack power, 2 hr, party or raid. Tooltip: "May not be combined with similar long-duration effects." How it is obtained and what it excludes are unknown.' },

  // Shaman totems (no slot: Forever totem-slot rules are unresolved)
  { id: 'strength-of-earth-totem', name: 'Strength of Earth Totem', kind: 'raid-buff', category: 'stats', spellId: 8075, providers: [{ className: 'Shaman' }], ...provisional,
    sources: [spell(8075), buildArticle], notes: '+53 Strength, 30 yards, party or raid per the build article. Ranks 8075 to 25361 (5 ranks).' },
  { id: 'grace-of-air-totem', name: 'Grace of Air Totem', kind: 'raid-buff', category: 'stats', spellId: 8835, providers: [{ className: 'Shaman' }], ...provisional,
    sources: [spell(8835), buildArticle], notes: '+89 Agility, 30 yards, party or raid per the build article. Ranks 8835, 10627, 25359.' },
  { id: 'windfury-totem', name: 'Windfury Totem', kind: 'raid-buff', stackGroup: 'extra-melee-attacks', category: 'melee damage', spellId: 8512, providers: [{ className: 'Shaman' }], ...provisional,
    sources: [spell(8512), buildArticle], notes: 'Extra melee attack chance, 30 yards, party or raid per the build article. Ranks 8512, 10613, 10614.' },
  { id: 'wild-strikes', name: 'Wild Strikes', kind: 'raid-buff', stackGroup: 'extra-melee-attacks', category: 'melee damage', spellId: 410021, providers: [{ className: 'Druid', talent: 'Rune: Wild Strikes' }], ...unverified,
    sources: [spell(410021)], notes: 'Rune engraving (availability unknown); needs Cat or Bear form. Tooltip: no effect if the target already benefits from Windfury Totem, so it shares a requirement with it.' },
  { id: 'flametongue-totem', name: 'Flametongue Totem', kind: 'raid-buff', category: 'melee damage', spellId: 8227, providers: [{ className: 'Shaman' }], ...provisional,
    sources: [spell(8227), buildArticle], notes: 'Fire damage on melee hits, 30 yards, party or raid per the build article. Ranks 8227 to 16387 (4 ranks).' },

  // Total stats
  { id: 'blessing-of-kings', name: 'Blessing of Kings', kind: 'targeted-buff', category: 'stats', spellId: 20217, providers: [{ className: 'Paladin' }], ...provisional,
    sources: [spell(20217)], notes: '+10% total stats, 1 hr. Greater version 25898 covers same-class members.' },
  { id: 'heart-of-the-lion', visibility: 'excluded', name: 'Heart of the Lion', kind: 'party-buff', category: 'stats', spellId: 409580, providers: [{ className: 'Hunter' }], ...unverified,
    sources: [spell(409580)], notes: '+10% total stats and +280 attack power for "nearby allies". Range and party or raid scope are not stated, so it is listed as party-buff. Listed under the Survival skill line only. Relationship to Blessing of Kings is unknown, so it is a separate requirement.' },

  // Priest, Mage and Druid buffs: single-target and group versions are alternatives for one requirement
  { id: 'power-word-fortitude', name: 'Power Word: Fortitude', kind: 'targeted-buff', stackGroup: 'stamina', category: 'stats', spellId: 1243, providers: [{ className: 'Priest' }], ...provisional,
    sources: [spell(1243)], notes: '+70 Stamina, 1 hr. Ranks 1243 to 10938 (6 ranks); Improved 14749, 14767.' },
  { id: 'prayer-of-fortitude', name: 'Prayer of Fortitude', kind: 'targeted-buff', stackGroup: 'stamina', category: 'stats', spellId: 21562, providers: [{ className: 'Priest' }], ...provisional,
    sources: [spell(21562)], notes: 'Tooltip scope: "party and raid", reagent. Listed as targeted-buff because it shares a requirement with Power Word: Fortitude. Ranks 21562, 21564.' },
  { id: 'divine-spirit', name: 'Divine Spirit', kind: 'targeted-buff', stackGroup: 'spirit', category: 'stats', spellId: 14752, providers: [{ className: 'Priest' }], ...provisional,
    sources: [spell(14752)], notes: '+40 Spirit, 1 hr. Ranks 14752 to 27841 (4 ranks).' },
  { id: 'prayer-of-spirit', name: 'Prayer of Spirit', kind: 'targeted-buff', stackGroup: 'spirit', category: 'stats', spellId: 27681, providers: [{ className: 'Priest' }], ...provisional,
    sources: [spell(27681)], notes: 'Tooltip scope: "party and raid", reagent. Listed as targeted-buff because it shares a requirement with Divine Spirit.' },
  { id: 'dark-inspiration', name: 'Dark Inspiration', kind: 'targeted-buff', stackGroup: 'spirit', category: 'stats', spellId: 1326159, providers: [{ className: 'Priest', talent: 'Dark Inspiration' }], ...unverified,
    sources: [spell(1326159)], notes: 'A +15% Spirit proc for 10 sec, party. Talent tree unclear. Its relationship to the Spirit buffs is not stated.' },
  { id: 'arcane-intellect', name: 'Arcane Intellect', kind: 'targeted-buff', stackGroup: 'intellect', category: 'stats', spellId: 1459, providers: [{ className: 'Mage' }], ...provisional,
    sources: [spell(1459)], notes: '+31 Intellect, 1 hr. Ranks 1459 to 10157 (5 ranks).' },
  { id: 'arcane-brilliance', name: 'Arcane Brilliance', kind: 'targeted-buff', stackGroup: 'intellect', category: 'stats', spellId: 23028, providers: [{ className: 'Mage' }], ...provisional,
    sources: [spell(23028)], notes: 'Tooltip scope: "party and raid", reagent. Listed as targeted-buff because it shares a requirement with Arcane Intellect.' },
  { id: 'mark-of-the-wild', name: 'Mark of the Wild', kind: 'targeted-buff', stackGroup: 'mark-of-the-wild', category: 'stats', spellId: 1126, providers: [{ className: 'Druid' }], ...provisional,
    sources: [spell(1126)], notes: 'Armor, attributes and resistances, 1 hr. Ranks 1126 to 9885 (7 ranks). Gift of the Wild may also count toward fire resistance; overlap is not stated.' },
  { id: 'gift-of-the-wild', name: 'Gift of the Wild', kind: 'targeted-buff', stackGroup: 'mark-of-the-wild', category: 'stats', spellId: 21849, providers: [{ className: 'Druid' }], ...provisional,
    sources: [spell(21849)], notes: 'Tooltip scope: "all party and raid members", reagent. Listed as targeted-buff because it shares a requirement with Mark of the Wild. Ranks 21849, 21850.' },

  // Mana regeneration (stacking between these is unknown)
  { id: 'blessing-of-wisdom', name: 'Blessing of Wisdom', kind: 'targeted-buff', stackGroup: 'mana-regeneration', category: 'mana', spellId: 19742, providers: [{ className: 'Paladin' }], ...provisional,
    sources: [spell(19742)], notes: '40 mana per 5 sec, 1 hr. Ranks 19742 to 25290 (6 ranks); Greater 25894, 25918.' },
  { id: 'mana-spring-totem', name: 'Mana Spring Totem', kind: 'targeted-buff', stackGroup: 'mana-regeneration', category: 'mana', spellId: 5675, providers: [{ className: 'Shaman' }], ...provisional,
    sources: [spell(5675)], notes: 'Group totem, 10 mana per 2 sec, 30 yards. Listed as targeted-buff because it shares a requirement with Blessing of Wisdom. Ranks 5675 to 10497 (4 ranks).' },
  { id: 'mana-tide-totem', name: 'Mana Tide Totem', kind: 'targeted-buff', stackGroup: 'mana-regeneration', category: 'mana', spellId: 16190, providers: [{ className: 'Shaman', specs: ['Restoration'], talent: 'Mana Tide Totem (Restoration tree, inferred)' }], ...unverified,
    sources: [spell(16190)], notes: 'Group totem, 290 mana per 3 sec for 12 sec. Ranks 16190 to 1325256 (4 ranks; IDs look unusual).' },
  { id: 'vampiric-touch', name: 'Vampiric Touch', kind: 'targeted-buff', stackGroup: 'mana-regeneration', category: 'mana', spellId: 402668, providers: [{ className: 'Priest' }], ...unverified,
    sources: [spell(402668)], notes: 'Mana to the party equal to 2% of Shadow damage. Spec requirement not read from the database.' },

  // Healing and threat
  { id: 'blessing-of-light', name: 'Blessing of Light', kind: 'targeted-buff', category: 'healing', spellId: 19977, providers: [{ className: 'Paladin' }], ...provisional,
    sources: [spell(19977)], notes: 'Bonus healing from Holy Light and Flash of Light on the target. Ranks 19977, 19978, 19979; Greater 25890.' },
  { id: 'salvation', name: 'Salvation / Mass Salvation', kind: 'targeted-buff', category: 'threat', spellId: 1038, providers: [{ className: 'Paladin' }], ...provisional,
    sources: [spell(1038), spell(25895), buildArticle], notes: '-30% threat. Mass Salvation (25895, renamed from Greater Blessing of Salvation) no longer carries the one-Blessing-per-Paladin restriction. Interaction with other blessings is unresolved.' },
  { id: 'devotion-aura', visibility: 'excluded', name: 'Devotion Aura', kind: 'party-buff', category: 'armor', spellId: 465, providers: [{ className: 'Paladin' }], ...provisional,
    sources: [spell(465)], notes: 'Armor, party, 30 yards. Tooltip: one Aura per Paladin. Ranks 465 to 10293 (7 ranks); Improved Devotion Aura 20138 is a talent that only improves the value.' },

  // Damage reduction (stacking unknown)
  { id: 'stoneskin-totem', visibility: 'excluded', name: 'Stoneskin Totem', kind: 'party-buff', stackGroup: 'physical-damage-reduction', category: 'damage reduction', spellId: 8071, providers: [{ className: 'Shaman' }], ...unverified,
    sources: [spell(8071)], notes: '-30 physical damage taken, party, 30 yards. Ranks 8071 to 10408 (6 ranks).' },
  { id: 'windwall-totem', name: 'Windwall Totem', kind: 'party-buff', stackGroup: 'physical-damage-reduction', category: 'damage reduction', spellId: 15107, providers: [{ className: 'Shaman' }], ...unverified,
    sources: [spell(15107)], notes: '-64 ranged damage taken, party, 30 yards. Ranks 15107, 15111, 15112.' },

  // Resistances (overlap between sources is not stated)
  { id: 'fire-resistance-totem', visibility: 'encounter', name: 'Fire Resistance Totem', kind: 'raid-buff', stackGroup: 'fire-resistance', category: 'resistance', spellId: 8184, providers: [{ className: 'Shaman' }], ...provisional,
    sources: [spell(8184), buildArticle], notes: '+60 fire resistance, 30 yards, party or raid per the build article. Ranks 8184, 10537, 10538.' },
  { id: 'fire-resistance-aura', visibility: 'encounter', name: 'Fire Resistance Aura', kind: 'raid-buff', stackGroup: 'fire-resistance', category: 'resistance', spellId: 19891, providers: [{ className: 'Paladin' }], ...provisional,
    sources: [spell(19891)], notes: '+60 fire resistance, 30 yards. Tooltip scope: "party and raid", read as raid-wide. One Aura per Paladin. Ranks 19891, 19899, 19900.' },
  { id: 'frost-resistance-totem', visibility: 'encounter', name: 'Frost Resistance Totem', kind: 'raid-buff', stackGroup: 'frost-resistance', category: 'resistance', spellId: 8181, providers: [{ className: 'Shaman' }], ...provisional,
    sources: [spell(8181)], notes: '+60 frost resistance, 30 yards. Tooltip scope: "party and raid", read as raid-wide. Ranks 8181, 10478, 10479.' },
  { id: 'frost-resistance-aura', visibility: 'encounter', name: 'Frost Resistance Aura', kind: 'raid-buff', stackGroup: 'frost-resistance', category: 'resistance', spellId: 19888, providers: [{ className: 'Paladin' }], ...provisional,
    sources: [spell(19888)], notes: '+60 frost resistance, 30 yards. Tooltip scope: "party and raid", read as raid-wide. One Aura per Paladin. Ranks 19888, 19897, 19898.' },
  { id: 'nature-resistance-totem', visibility: 'encounter', name: 'Nature Resistance Totem', kind: 'raid-buff', stackGroup: 'nature-resistance', category: 'resistance', spellId: 10595, providers: [{ className: 'Shaman' }], ...provisional,
    sources: [spell(10595)], notes: '+60 nature resistance, 30 yards. Tooltip scope: "party and raid", read as raid-wide. Ranks 10595, 10600, 10601.' },
  { id: 'aspect-of-the-wild', visibility: 'encounter', name: 'Aspect of the Wild', kind: 'raid-buff', stackGroup: 'nature-resistance', category: 'resistance', spellId: 20043, providers: [{ className: 'Hunter' }], ...provisional,
    sources: [spell(20043)], notes: '+60 nature resistance, 30 yards. Tooltip scope: "party and raid", read as raid-wide. Tooltip: only one Aspect active at a time. Ranks 20043, 20190.' },
  { id: 'shadow-resistance-aura', visibility: 'encounter', name: 'Shadow Resistance Aura', kind: 'targeted-buff', stackGroup: 'shadow-resistance', category: 'resistance', spellId: 19876, providers: [{ className: 'Paladin' }], ...provisional,
    sources: [spell(19876)], notes: '+60 shadow resistance, 30 yards, "party and raid". Listed as targeted-buff because it shares a requirement with Shadow Protection. One Aura per Paladin. Ranks 19876, 19895, 19896.' },
  { id: 'prayer-of-shadow-protection', visibility: 'encounter', name: 'Prayer of Shadow Protection', kind: 'targeted-buff', stackGroup: 'shadow-resistance', category: 'resistance', spellId: 27683, providers: [{ className: 'Priest' }], ...provisional,
    sources: [spell(27683)], notes: '+60 shadow resistance, 20 min, "party and raid". Listed as targeted-buff because it shares a requirement with Shadow Protection.' },
  { id: 'shadow-protection', visibility: 'encounter', name: 'Shadow Protection', kind: 'targeted-buff', stackGroup: 'shadow-resistance', category: 'resistance', spellId: 976, providers: [{ className: 'Priest' }], ...provisional,
    sources: [spell(976)], notes: '+60 shadow resistance, 10 min. Ranks 976, 10957, 10958.' },

  // Enemy debuffs. Armor reduction: stacking between these is not stated, so none is assumed (no Classic rules copied).
  { id: 'sunder-armor', name: 'Sunder Armor', kind: 'debuff', stackGroup: 'armor-reduction', category: 'enemy debuff', spellId: 7386, providers: [{ className: 'Warrior' }], ...provisional,
    sources: [spell(7386)], notes: '-450 armor per application, up to 5, 30 sec. Ranks 7386, 7405, 8380, 11596, 11597.' },
  { id: 'expose-armor', name: 'Expose Armor', kind: 'debuff', stackGroup: 'armor-reduction', category: 'enemy debuff', spellId: 8647, providers: [{ className: 'Rogue' }], ...provisional,
    sources: [spell(8647)], notes: 'Armor reduction by combo points (450 per point, 1,800 at four). Ranks 8647 to 11198 (5 ranks).' },
  { id: 'faerie-fire', name: 'Faerie Fire', kind: 'debuff', stackGroup: 'armor-reduction', category: 'enemy debuff', spellId: 770, providers: [{ className: 'Druid' }], ...provisional,
    sources: [spell(770)], notes: '-505 armor, 40 sec. Ranks 770 to 9907 (4 ranks).' },
  { id: 'curse-of-recklessness', name: 'Curse of Recklessness', kind: 'debuff', stackGroup: 'armor-reduction', category: 'enemy debuff', spellId: 704, providers: [{ className: 'Warlock' }], ...provisional,
    sources: [spell(704)], notes: '-505 armor, 2 min. Tooltip: one Curse per Warlock per target. Ranks 704 to 11717 (4 ranks).' },
  { id: 'demoralizing-shout', name: 'Demoralizing Shout', kind: 'debuff', stackGroup: 'melee-attack-power-reduction', category: 'enemy debuff', spellId: 1160, providers: [{ className: 'Warrior' }], ...provisional,
    sources: [spell(1160)], notes: '-210 melee attack power, 45 sec, 10 yards. Ranks 1160 to 11556 (5 ranks).' },
  { id: 'demoralizing-roar', name: 'Demoralizing Roar', kind: 'debuff', stackGroup: 'melee-attack-power-reduction', category: 'enemy debuff', spellId: 99, providers: [{ className: 'Druid' }], ...provisional,
    sources: [spell(99)], notes: '-207 melee attack power, 30 sec. Bear form, which is not tracked. Ranks 99 to 9898 (5 ranks).' },
  { id: 'hex-of-weakness', name: 'Hex of Weakness', kind: 'debuff', stackGroup: 'melee-attack-power-reduction', category: 'enemy debuff', spellId: 9035, providers: [{ className: 'Priest' }], ...unverified,
    sources: [spell(9035)], notes: '-204 melee attack power and -20% healing, 2 min. Ranks 9035 to 19285 (6 ranks). Race requirement not checked.' },
  { id: 'curse-of-weakness', name: 'Curse of Weakness', kind: 'debuff', stackGroup: 'melee-attack-power-reduction', category: 'enemy debuff', spellId: 702, providers: [{ className: 'Warlock' }], ...provisional,
    sources: [spell(702)], notes: '-37 physical damage dealt, 2 min. Tooltip: one Curse per Warlock per target. Ranks 702 to 11708 (6 ranks); Improved 18179 to 18181.' },
  { id: 'thunder-clap', name: 'Thunder Clap', kind: 'debuff', stackGroup: 'attack-speed-reduction', category: 'enemy debuff', spellId: 6343, providers: [{ className: 'Warrior' }], ...provisional,
    sources: [spell(6343)], notes: '+20% time between enemy attacks, 30 sec, up to 4 targets. Ranks 6343 to 11581 (6 ranks).' },
  { id: 'homunculi', name: 'Homunculi', kind: 'debuff', stackGroup: 'attack-speed-reduction', category: 'enemy debuff', spellId: 402799, providers: [{ className: 'Priest', talent: 'Rune: Homunculi' }], ...unverified,
    sources: [spell(402799)], notes: 'Rune engraving (availability unknown). Summons copies that lower attack speed, attack power and armor of targets they hit.' },
  { id: 'curse-of-the-elements', name: 'Curse of the Elements', kind: 'debuff', category: 'enemy debuff', spellId: 440892, providers: [{ className: 'Warlock' }], ...provisional,
    sources: [spell(440892)], notes: '-75 magic resistance and +10% magic damage taken, 5 min. Tooltip: one Curse per Warlock per target. Ranks 440892 to 1311680 (4 ranks); the IDs look unusual.' },
  { id: 'hunters-mark', name: "Hunter's Mark", kind: 'debuff', category: 'enemy debuff', spellId: 1130, providers: [{ className: 'Hunter' }], ...provisional,
    sources: [spell(1130)], notes: '+71 ranged attack power for attackers, 2 min. Ranks 1130, 14323, 14324, 14325.' },
  { id: 'curse-of-tongues', name: 'Curse of Tongues', kind: 'debuff', category: 'enemy debuff', spellId: 1714, providers: [{ className: 'Warlock' }], ...provisional,
    sources: [spell(1714)], notes: '+60% spell casting time, 30 sec. Tooltip: one Curse per Warlock per target. Ranks 1714, 11719.' },
  { id: 'judgement-of-wisdom', visibility: 'excluded', name: 'Judgement of Wisdom', kind: 'debuff', stackGroup: 'judgement', category: 'enemy debuff', spellId: 20166, providers: [{ className: 'Paladin' }], ...unverified,
    sources: [spell(20166)], notes: 'From Seal of Wisdom (20166, 20356, 20357): attackers restore mana. Tooltip: one Judgement per Paladin. Whether the two Judgements are alternatives is not stated.' },
  { id: 'judgement-of-light', visibility: 'excluded', name: 'Judgement of Light', kind: 'debuff', stackGroup: 'judgement', category: 'enemy debuff', spellId: 20165, providers: [{ className: 'Paladin' }], ...unverified,
    sources: [spell(20165)], notes: 'From Seal of Light (20165, 20347 to 20349): melee attackers are healed. Tooltip: one Judgement per Paladin.' },

  // Fear protection
  { id: 'tremor-totem', visibility: 'excluded', name: 'Tremor Totem', kind: 'targeted-buff', stackGroup: 'fear-protection', category: 'utility', spellId: 8143, providers: [{ className: 'Shaman' }], ...unverified,
    sources: [spell(8143)], notes: 'Real scope is party, 30 yards: removes Fear, Charm and Sleep. Listed as targeted-buff because it shares a requirement with Fear Ward.' },
  { id: 'fear-ward', visibility: 'excluded', name: 'Fear Ward', kind: 'targeted-buff', stackGroup: 'fear-protection', category: 'utility', spellId: 6346, providers: [{ className: 'Priest' }], ...unverified,
    sources: [spell(6346)], notes: 'The next Fear on the target fails.' },
]
