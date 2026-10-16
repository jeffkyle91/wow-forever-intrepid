# Raid Coverage Research: WoW Forever buffs and debuffs

**Status:** Research draft for review. Not owner-approved. Not used by `coverageData.ts`.
**Research date:** 2026-10-16. **Wowhead Forever database patch shown on pages:** 1.60.1.
**Scope of this phase:** research only. No production catalog, engine, UI, Firebase, auth or routing changes.

## 1. Method and what "verified" means here

Sources used (all Wowhead Forever; no Classic or TBC pages):

| Source | Used for |
|---|---|
| [Many Buffs Now Raid-Wide: Class Changes in Latest WoW: Forever Build](https://www.wowhead.com/forever/news/many-buffs-now-raid-wide-class-changes-in-latest-wow-forever-build-383456) | Most recent build diff (tooltip changes tagged inserted/deleted). Newest applicable source. |
| `https://www.wowhead.com/forever/spells/abilities/<class>` and `/spells/talents/<class>` for all nine classes | Class ability and talent lists (2,268 ability rows, 465 talent rows, 1,371 distinct class/name pairs), including spell IDs and ranks. |
| `https://www.wowhead.com/forever/spell=<id>` | Current tooltip text per spell (description, scope wording, range, duration). |

Method notes:

- The article page renders its body with JavaScript. The text was read from the markup embedded in the page HTML, which contains the full build diff. A web-search AI summary also existed, but it is a secondary source and is **not** cited anywhere below.
- The list pages show only 1,000 rows per query, so lists were fetched per class and category.
- Only class abilities, talents and rune engravings (which Wowhead lists as "Engrave ..." abilities) were reviewed. Items, consumables, racials, pets, world buffs and consumable-style effects were **not** reviewed.

### Verification levels used in this document

The schema reserves `confirmed` for effects checked against the game with a `verifiedOn` date. Nothing in this research was checked in game or approved by the repository owner, so:

| Level | Meaning in this document | Count |
|---|---|---|
| **Confirmed** | Checked in game and approved by the owner. | **0** |
| **Provisional** | Current Wowhead Forever tooltip states provider, scope and effect clearly. Not game-checked. | 46 |
| **Unverified** | Ambiguous or incomplete wording, rune engravings (availability unknown), unclear spec requirement, odd values, or conflicting information. | 36 |

"Exists in the database" is not the same as "coverage mechanics verified". A database entry only tells us the spell and its tooltip text exist. It does not tell us how the effect behaves in a raid (range, stacking, which ranks apply, talent requirements as implemented). **No `verifiedOn` dates are proposed for any entry.**

### Caveats that apply to every entry

1. **Spec is not read from abilities.** Wowhead lists baseline abilities under a skill line (for example Blessing of Kings appears under the Protection skill line). That is a category, not a spec requirement. For baseline abilities the provider is the whole class. For talents the spec comes from the talent tree and is marked "inferred" until checked in the Forever talent calculator.
2. **Talent tooltips show rank-0 numbers** (for example "0% chance"). Values on talent tooltips are unreliable; only the effect and scope are recorded.
3. **Ranges matter.** Wowhead scopes such as "party or raid members within 30 yards" are range-limited. The checklist can only say a provider exists, not that every raider is in range.
4. **Rank IDs.** Each ability has several rank spell IDs. All IDs found are kept in the tables so the catalog can store them.

## 2. Recent change: buffs made raid-wide (primary finding)

The article opens with: "many buffs becoming raid-wide" and lists these spells. The diff text shows the inserted wording "or raid". All are marked **Provisional**, based on the article diff plus the current database tooltip.

| Class | Effect | Spell IDs named in article | Change |
|---|---|---|---|
| Druid | Moonkin Form (spell crit) | [24858](https://www.wowhead.com/forever/spell=24858) | "all party **or raid** members within 45 yards ... spell Critical Strike chance +3%". The "exclusive with Leader of the Pack" wording was **deleted**. |
| Druid | Leader of the Pack | [17007](https://www.wowhead.com/forever/spell=17007) | "melee and ranged Critical Strike chance of all party **or raid** members within 45 yards by 3%". "exclusive with Moonkin Aura" **deleted**. |
| Hunter | Trueshot Aura | [1299346](https://www.wowhead.com/forever/spell=1299346) | "party **or raid** members within 45 yds". |
| Shaman | Fire Resistance Totem | [8184](https://www.wowhead.com/forever/spell=8184) | "party **or** raid members within 30 yards by 45" (previously "party and raid"). |
| Shaman | Flametongue Totem | [8227](https://www.wowhead.com/forever/spell=8227) | Melee attacks of all party **or raid** members within 30 yards. |
| Shaman | Grace of Air Totem | [8835](https://www.wowhead.com/forever/spell=8835) | Agility of party **or raid** members within 30 yards. |
| Shaman | Strength of Earth Totem | [8075](https://www.wowhead.com/forever/spell=8075) | Strength of party **or raid** members within 30 yards. |
| Shaman | Windfury Totem | [8512](https://www.wowhead.com/forever/spell=8512) | Melee attacks of all party **or raid** members within 30 yards. |
| Warrior | Battle Shout | [5242](https://www.wowhead.com/forever/spell=5242) | "all party **or raid** members within **20 yards**". |

Other buff-relevant changes in the same article:

- **Paladin:** spell [25895](https://www.wowhead.com/forever/spell=25895) was "Greater Blessing of Salvation" and is now **Mass Salvation** in the database. The "Players may only have one Blessing on them per Paladin" restriction was deleted for it. A new spell, [Revoke 1325499](https://www.wowhead.com/forever/spell=1325499), removes Salvation or Mass Salvation from a target.
- **Druid:** the Tree of Life rune ([439767](https://www.wowhead.com/forever/spell=439767)) still says "all **party** members" (not raid).
- **Trueshot Aura** has a second rank set with new IDs (1299346 and 1299348) alongside the older 19506, 20905 and 20906. See conflicts in §6.

## 3. Candidate effects by class

Columns: **ID** (research ID, not the catalog `id`); **Effect and spell IDs**; **Provider** (class; spec or talent where applicable); **Scope**; **Notes and stacking wording from the tooltip**; **Level**. Scope values are `raid`, `party`, `targeted`, `enemy`. URL pattern for every spell ID: `https://www.wowhead.com/forever/spell=<id>`.

### Warrior (8)

| ID | Effect and spell IDs | Provider | Scope | Notes | Level |
|---|---|---|---|---|---|
| E01 | Battle Shout: 5242, 6192, 6673, 11549, 11550, 11551, 25289 | Warrior (any) | raid, 20 yd | Melee AP, 3 min. Raid-wide per build article. | Provisional |
| E02 | Commanding Shout: 403215 | Warrior | party, 30 yd | Stamina "by 2", 5 min. The value looks wrong or is a placeholder. | Unverified |
| E03 | Valor of Azeroth: 461475 | Warrior | party or raid | +5% crit (all spells and attacks), +90 AP, 2 hr. "May not be combined with similar long-duration effects." Obtaining and exclusivity group unknown. | Unverified |
| E04 | Rallying Cry: 426490 (rune variant 426491) | Warrior | raid, 40 yd | +15% max health for 10 sec. Short cooldown effect. | Provisional |
| E05 | Sunder Armor: 7386, 7405, 8380, 11596, 11597 (5 ranks) | Warrior | enemy | -450 armor per application, up to 5, 30 sec. | Provisional |
| E06 | Demoralizing Shout: 1160 to 11556 (5 ranks) | Warrior | enemy, 10 yd | -210 melee AP, 45 sec. | Provisional |
| E07 | Thunder Clap: 6343 to 11581 (6 ranks) | Warrior | enemy | +20% time between attacks, 30 sec, up to 4 targets. | Provisional |
| E08 | Vigilance (rune): 427078 | Warrior (rune) | targeted | -3% damage taken for the target and threat transfer. Rune availability unknown. | Unverified |

### Paladin (19)

Blessing tooltips say "Players may only have one Blessing on them per Paladin at any one time." Greater versions apply to "all members of the raid or group that share the same class with the target".

| ID | Effect and spell IDs | Provider | Scope | Notes | Level |
|---|---|---|---|---|---|
| E09 | Blessing of Kings 20217; Greater 25898 | Paladin | targeted (Greater: same-class members) | +10% total stats, 1 hr. | Provisional |
| E10 | Blessing of Might 19740 to 25291 (7 ranks); Greater 25782, 25916 | Paladin | targeted | +133 melee AP, 1 hr. | Provisional |
| E11 | Blessing of Wisdom 19742 to 25290 (6); Greater 25894, 25918 | Paladin | targeted | 40 mana/5 sec, 1 hr. | Provisional |
| E12 | Blessing of Light 19977, 19978, 19979; Greater 25890 | Paladin | targeted | Holy Light and Flash of Light bonus healing on target. | Provisional |
| E13 | Salvation 1038; Mass Salvation 25895 | Paladin | targeted / same-class | -30% threat. Mass Salvation no longer exclusive with other blessings (build article). | Provisional |
| E14 | Blessing of Protection 1022, 5599, 10278 | Paladin | targeted | Physical immunity 10 sec (Forbearance). | Unverified |
| E15 | Blessing of Sacrifice 6940, 20729; Hand of Sacrifice rune 410010 | Paladin | targeted | Damage transfer. Rune availability unknown. | Unverified |
| E16 | Blessing of Freedom 1044 | Paladin | targeted | Movement-impairment immunity 10 sec. | Unverified |
| E17 | Devotion Aura 465 to 10293 (7); Improved 20138 | Paladin (talent for the improvement) | party, 30 yd | +armor. "Only one Aura on them per Paladin." | Provisional |
| E18 | Concentration Aura 19746; Improved 20254 | Paladin | party, 30 yd | Spell-interrupt resistance. | Unverified |
| E19 | Retribution Aura 7294 to 10301 (5) | Paladin | party, 30 yd | Damage to attackers. Low coverage value. | Unverified |
| E20 | Fire Resistance Aura 19891, 19899, 19900 | Paladin | "party and raid", 30 yd | +60 fire resistance. | Provisional |
| E21 | Frost Resistance Aura 19888, 19897, 19898 | Paladin | "party and raid", 30 yd | +60 frost resistance. | Provisional |
| E22 | Shadow Resistance Aura 19876, 19895, 19896 | Paladin | "party and raid", 30 yd | +60 shadow resistance. | Provisional |
| E23 | Horn of Lordaeron 425600 | Paladin | party, 30 yd | Strength and agility, 2 min. **"Exclusive with Blessing of Might."** | Provisional |
| E24 | Divine Sacrifice 407804 | Paladin | party, 30 yd | 30% of party damage redirected to the Paladin, 10 sec. | Unverified |
| E25 | Seal of Martyrdom 407798, 407799 | Paladin | party or raid, 40 yd | Mana to party/raid from the paladin's self-damage. | Unverified |
| E26 | Judgement of Wisdom (from Seal of Wisdom 20166, 20356, 20357) | Paladin | enemy | Attackers restore mana. "Only one Judgement per Paladin." | Unverified |
| E27 | Judgement of Light (from Seal of Light 20165, 20347 to 20349) | Paladin | enemy | Melee attackers healed. One Judgement per Paladin. | Unverified |

### Hunter (5)

| ID | Effect and spell IDs | Provider | Scope | Notes | Level |
|---|---|---|---|---|---|
| E28 | Trueshot Aura 1299346, 1299348, 19506, 20905, 20906 | Hunter; talent, Marksmanship (inferred) | raid, 45 yd | Ranged AP. IDs and values conflict (§6). | Provisional |
| E29 | Aspect of the Wild 20043, 20190 | Hunter | "party and raid", 30 yd | +60 nature resistance. "Only one Aspect can be active at a time." | Provisional |
| E30 | Aspect of the Pack 13159 | Hunter | group, 30 yd | +30% movement speed. Low value. | Unverified |
| E31 | Hunter's Mark 1130, 14323, 14324, 14325 | Hunter | enemy | +71 ranged AP for attackers, 2 min. | Provisional |
| E32 | Heart of the Lion 409580 | Hunter (Survival skill line only) | "nearby allies" | +10% total stats and +280 AP. Range and party/raid scope **not stated**. | Unverified |

### Rogue (1)

| ID | Effect and spell IDs | Provider | Scope | Notes | Level |
|---|---|---|---|---|---|
| E33 | Expose Armor 8647 to 11198 (5 ranks) | Rogue | enemy | Armor reduction by combo points (450 per point; 1,800 at 4). | Provisional |

### Priest (15)

| ID | Effect and spell IDs | Provider | Scope | Notes | Level |
|---|---|---|---|---|---|
| E34 | Power Word: Fortitude 1243 to 10938 (6); Improved 14749, 14767 | Priest | targeted | +70 Stamina, 1 hr. | Provisional |
| E35 | Prayer of Fortitude 21562, 21564 | Priest | "party and raid" | +70 Stamina, 1 hr, reagent. | Provisional |
| E36 | Divine Spirit 14752 to 27841 (4) | Priest | targeted | +40 Spirit, 1 hr. | Provisional |
| E37 | Prayer of Spirit 27681 | Priest | "party and raid" | +40 Spirit, 1 hr, reagent. | Provisional |
| E38 | Shadow Protection 976, 10957, 10958 | Priest | targeted | +60 shadow resistance, 10 min. | Provisional |
| E39 | Prayer of Shadow Protection 27683 | Priest | "party and raid" | +60 shadow resistance, 20 min. | Provisional |
| E40 | Power Infusion 10060 | Priest; talent, Discipline (inferred) | targeted | +20% spell damage and healing, 15 sec. | Provisional |
| E41 | Pain Suppression 402004 (rune 402855) | Priest | targeted | -40% damage taken, 8 sec. | Unverified |
| E42 | Power Word: Barrier 425207 (rune 425213) | Priest | party, area | -25% damage taken, 10 sec. | Unverified |
| E43 | Dark Inspiration 1326159 | Priest; talent (spec unclear) | party | +15% Spirit proc, 10 sec. | Unverified |
| E44 | Vampiric Embrace 15286 | Priest; talent, Shadow (inferred) | party | Party healed from the priest's Shadow damage. | Unverified |
| E45 | Vampiric Touch 402668 | Priest | party | Mana to party equal to 2% of Shadow damage. | Unverified |
| E46 | Hex of Weakness 9035 to 19285 (6) | Priest | enemy | -204 melee AP, -20% healing, 2 min. | Unverified |
| E47 | Homunculi 402799 (rune 402852) | Priest | enemy | Summons copies that lower attack speed, AP and armor of targets they hit. | Unverified |
| E48 | Fear Ward 6346 | Priest | targeted | Next Fear fails. | Unverified |

### Shaman (15)

Totems are one per element at a time (Earth, Fire, Water, Air). The tooltips state "Tools:" and an element.

| ID | Effect and spell IDs | Provider | Scope | Notes | Level |
|---|---|---|---|---|---|
| E49 | Strength of Earth Totem 8075 to 25361 (5) | Shaman | raid, 30 yd | +53 Strength (Earth totem). | Provisional |
| E50 | Grace of Air Totem 8835, 10627, 25359 | Shaman | raid, 30 yd | +89 Agility (Air totem). | Provisional |
| E51 | Windfury Totem 8512, 10613, 10614 | Shaman | raid, 30 yd | Extra attack chance (Air totem). | Provisional |
| E52 | Flametongue Totem 8227 to 16387 (4) | Shaman | raid, 30 yd | Fire damage on melee hits (Fire totem). | Provisional |
| E53 | Fire Resistance Totem 8184, 10537, 10538 | Shaman | raid, 30 yd | +60 fire resistance (Water totem). | Provisional |
| E54 | Frost Resistance Totem 8181, 10478, 10479 | Shaman | "party and raid", 30 yd | +60 frost resistance (Fire totem). Wording differs from E53. | Provisional |
| E55 | Nature Resistance Totem 10595, 10600, 10601 | Shaman | "party and raid", 30 yd | +60 nature resistance (Air totem). | Provisional |
| E56 | Mana Spring Totem 5675 to 10497 (4) | Shaman | group, 30 yd | 10 mana/2 sec (Water). | Provisional |
| E57 | Mana Tide Totem 16190 to 1325256 (4) | Shaman; talent, Restoration (inferred) | group, 30 yd | 290 mana/3 sec, 12 sec. | Unverified |
| E58 | Healing Stream Totem 5394 to 10463 (5) | Shaman | group, 30 yd | Heals group. | Unverified |
| E59 | Stoneskin Totem 8071 to 10408 (6) | Shaman | party, 30 yd | -30 physical damage taken. | Unverified |
| E60 | Windwall Totem 15107, 15111, 15112 | Shaman | party, 30 yd | -64 ranged damage taken. | Unverified |
| E61 | Tremor Totem 8143 | Shaman | party, 30 yd | Removes Fear, Charm, Sleep. | Unverified |
| E62 | Poison Cleansing Totem 8166 | Shaman | party, 30 yd | Removes poison. | Unverified |
| E63 | Disease Cleansing Totem 8170 | Shaman | party, 30 yd | Removes disease. | Unverified |

### Mage (4)

| ID | Effect and spell IDs | Provider | Scope | Notes | Level |
|---|---|---|---|---|---|
| E64 | Arcane Intellect 1459 to 10157 (5) | Mage | targeted | +31 Intellect, 1 hr. | Provisional |
| E65 | Arcane Brilliance 23028 | Mage | "party and raid" | +31 Intellect, 1 hr, reagent. | Provisional |
| E66 | Amplify Magic 1008 to 10170 (4) | Mage | targeted | More spell damage and healing taken. Low value. | Unverified |
| E67 | Dampen Magic 604 to 10174 (5) | Mage | targeted | Less spell damage and healing taken. Low value. | Unverified |

### Warlock (5)

All curses: "Only one Curse per Warlock can be active on any one target."

| ID | Effect and spell IDs | Provider | Scope | Notes | Level |
|---|---|---|---|---|---|
| E68 | Curse of Recklessness 704 to 11717 (4) | Warlock | enemy | -505 armor, 2 min. | Provisional |
| E69 | Curse of the Elements 440892 to 1311680 (4) | Warlock | enemy | -75 magic resistance and +10% magic damage taken, 5 min. Rank IDs look unusual. | Provisional |
| E70 | Curse of Weakness 702 to 11708 (6); Improved 18179 to 18181 | Warlock | enemy | -37 physical damage dealt, 2 min. | Provisional |
| E71 | Curse of Tongues 1714, 11719 | Warlock | enemy | +60% spell casting time, 30 sec. | Provisional |
| E72 | Curse of Exhaustion 18223 | Warlock; talent (spec inferred) | enemy | -30% movement speed. Low value. | Unverified |

### Druid (10)

| ID | Effect and spell IDs | Provider | Scope | Notes | Level |
|---|---|---|---|---|---|
| E73 | Mark of the Wild 1126 to 9885 (7) | Druid | targeted | Armor, attributes and resistances, 1 hr. | Provisional |
| E74 | Gift of the Wild 21849, 21850 | Druid | "all party and raid members" | Same stats, 1 hr, reagent. | Provisional |
| E75 | Moonkin Form 24858 | Druid; talent, Balance | raid, 45 yd | +3% spell crit. | Provisional |
| E76 | Leader of the Pack 17007 | Druid; talent, Feral Combat | raid, 45 yd | +3% melee and ranged crit. Requires Cat, Bear or Dire Bear form. | Provisional |
| E77 | Faerie Fire 770 to 9907 (4) | Druid | enemy | -505 armor, 40 sec. | Provisional |
| E78 | Demoralizing Roar 99 to 9898 (5) | Druid (Bear form) | enemy | -207 melee AP, 30 sec. | Provisional |
| E79 | Innervate 29166 | Druid | targeted | +400% mana regeneration, 20 sec. | Unverified |
| E80 | Thorns 467 to 9910 (6) | Druid | targeted | Damage to attackers. Low value. | Unverified |
| E81 | Tree of Life rune 439767 | Druid (rune) | party, 45 yd | +10% healing received. Form-dependent. | Unverified |
| E82 | Wild Strikes rune 410021 | Druid (rune); Cat or Bear form | "party or raid", 100 yd | Extra-attack chance. "No effect if the target is already benefitting from Windfury Totem." | Unverified |

### Considered and excluded

| Effect | Reason |
|---|---|
| Improved Scorch ([11095](https://www.wowhead.com/forever/spell=11095)) | Forever tooltip says it increases Fire damage **you** deal, so it benefits the Mage only (Classic assumption would make it a raid debuff). Not a coverage effect unless the owner says otherwise. |
| Shadow Weaving ([15257](https://www.wowhead.com/forever/spell=15257)) | Increases Shadow damage the target takes **from you**. Personal. |
| Winter's Chill, Mortal Strike, Hemorrhage, Righteous Vengeance, Honor Among Thieves | Personal or class-damage effects. |
| Pet-only abilities (Dust Cloud, Savage Rend, Dismember, Lava Breath, Pinch, Tendon Rip, Swipe) | Pet skills. |
| Healing spells (Chain Heal, Prayer of Healing, Wild Growth, Circle of Healing, Healing Rain, Lightwell and similar) | Heals, not buffs. |
| Summoning rituals and portals | Logistics, not buffs. |
| Inner Fire, Demon Armor, armors, Aspects of the Hawk and Viper, Seal buffs on self | Self-only. |

### Searched for and not found in the Forever class lists

Curse of Shadow, Misery, Fire Vulnerability (as its own spell), Expose Weakness, Blood Pact, Mangle, Blessing of Sanctuary, Heroism, Bloodlust, Totem of Wrath, Wrath of Air Totem, Improved Faerie Fire. "Not found" means absent from the class ability and talent lists fetched on 2026-10-16. They may exist elsewhere (items, pets) or not at all.

## 4. Consolidated coverage requirements and alternative providers

This is a proposed grouping. **Stacking between different groups is mostly not stated by the tooltips and must be verified.** Only exclusivity the tooltips themselves state is recorded as a group.

| Req | Requirement | Alternative providers (research IDs) | Stacking and exclusivity evidence |
|---|---|---|---|
| R01 | Melee attack power (shout) | E01 Battle Shout | No exclusivity stated. |
| R02 | Melee attack power (paladin) | E10 Blessing of Might, E23 Horn of Lordaeron | Horn tooltip: "Exclusive with Blessing of Might." One group. |
| R03 | Ranged attack power aura | E28 Trueshot Aura | None stated. |
| R04 | Melee and ranged crit aura | E76 Leader of the Pack | Exclusivity with Moonkin **deleted** in the latest build. |
| R05 | Spell crit aura | E75 Moonkin Form | Same note as R04. R04 and R05 are therefore separate requirements. |
| R06 | Long-duration crit and AP | E03 Valor of Azeroth | "May not be combined with similar long-duration effects" (group unknown). |
| R07 | Strength | E49 Strength of Earth | None stated. |
| R08 | Agility | E50 Grace of Air | None stated. |
| R09 | Extra melee attacks | E51 Windfury Totem, E82 Wild Strikes | Wild Strikes: no effect if the target already has Windfury Totem. One group. |
| R10 | Melee fire damage | E52 Flametongue Totem | None stated. |
| R11 | Total stats | E09 Blessing of Kings, E32 Heart of the Lion | Relationship not stated. Not grouped. |
| R12 | Stamina | E34 Power Word: Fortitude, E35 Prayer of Fortitude | Likely alternatives (single vs raid cast of the same effect). Not stated. |
| R13 | Spirit | E36 Divine Spirit, E37 Prayer of Spirit, E43 Dark Inspiration | Single vs raid cast likely alternatives. Dark Inspiration is a proc. |
| R14 | Intellect | E64 Arcane Intellect, E65 Arcane Brilliance | Same single/raid pattern. |
| R15 | Armor, attributes and resistances | E73 Mark of the Wild, E74 Gift of the Wild | Same single/raid pattern. |
| R16 | Mana regeneration | E11 Blessing of Wisdom, E56 Mana Spring, E57 Mana Tide, E45 Vampiric Touch | Stacking unknown. Paladin and shaman versions may or may not stack. |
| R17 | Healing power | E12 Blessing of Light | None stated. |
| R18 | Threat reduction | E13 Salvation / Mass Salvation | Non-exclusive with other blessings (build article). |
| R19 | Armor aura | E17 Devotion Aura | One aura per Paladin. |
| R20 | Physical damage reduction | E59 Stoneskin Totem, E60 Windwall Totem | Stacking unknown. |
| R21 | Fire resistance | E53 Fire Resistance Totem, E20 Fire Resistance Aura, E74 Gift of the Wild | Overlap not stated. |
| R22 | Frost resistance | E54 Frost Resistance Totem, E21 Frost Resistance Aura | Not stated. |
| R23 | Nature resistance | E55 Nature Resistance Totem, E29 Aspect of the Wild | Not stated. |
| R24 | Shadow resistance | E22 Shadow Resistance Aura, E39 Prayer of Shadow Protection, E38 Shadow Protection | Not stated. |
| R25 | Enemy armor reduction | E05 Sunder Armor, E33 Expose Armor, E77 Faerie Fire, E68 Curse of Recklessness | **Not stated.** Classic assumptions must not be copied. |
| R26 | Enemy melee AP reduction | E06 Demoralizing Shout, E78 Demoralizing Roar, E46 Hex of Weakness, E70 Curse of Weakness | Not stated. |
| R27 | Enemy attack speed reduction | E07 Thunder Clap, E47 Homunculi | Not stated. |
| R28 | Enemy magic vulnerability | E69 Curse of the Elements | One curse per warlock. |
| R29 | Ranged AP vulnerability | E31 Hunter's Mark | None stated. |
| R30 | Enemy cast-time increase | E71 Curse of Tongues | One curse per warlock. |
| R31 | Judgement debuffs | E26 Judgement of Wisdom, E27 Judgement of Light | One Judgement per Paladin. |
| R32 | Fear protection | E61 Tremor Totem, E48 Fear Ward | Not stated. |
| R33 | Group max health cooldown | E04 Rallying Cry | Short cooldown. |
| R34 | Targeted cooldowns | E40 Power Infusion, E41 Pain Suppression, E79 Innervate, E14 Blessing of Protection, E15 Blessing of Sacrifice | Cooldown based. May not belong on a coverage checklist. |

## 5. Summary counts

| Measure | Count |
|---|---|
| Candidate effects (E01 to E82) | **82** |
| Confirmed | **0** |
| Provisional | **46** |
| Unverified | **36** |
| Consolidated requirements (R01 to R34) | 34 |
| Considered and excluded effect groups | 7 |
| Raid-wide scope changes found in the latest build article | 9 spells (plus the Mass Salvation rename) |

Counts by class (candidates): Warrior 8, Paladin 19, Hunter 5, Rogue 1, Priest 15, Shaman 15, Mage 4, Warlock 5, Druid 10.

## 6. Conflicts and discrepancies

| # | Topic | Detail | Handling |
|---|---|---|---|
| C1 | Trueshot Aura ranks | The article diff shows 19506 and 20906 at 50 ranged AP, 20905 at 75, 1299348 at 40 and 1299346 at 30. IDs do not map to a clean rank order, and the older IDs coexist with the newer pair. | Keep all five IDs. Do not assert a rank or value. Needs in-game check. |
| C2 | Moonkin and Leader of the Pack exclusivity | Older text said they were exclusive. The latest build deleted that wording. | Treat as separate requirements (R04, R05). The newest source wins. Verify in game. |
| C3 | "party and raid" vs "party or raid" | Some tooltips say "and" (Frost and Nature Resistance Totem, Aspect of the Wild, Prayer of ...) and the build changed others to "or". Only the build-listed spells are documented as changed. | Both read as raid-wide. Marked Provisional. Confirm the wording is cosmetic. |
| C4 | Mass Salvation naming | The article entry for 25895 is headed "Greater Blessing of Salvation", while the database now names it Mass Salvation. | Use the current database name. Note the rename. |
| C5 | Improved Scorch scope | Forever tooltip limits the bonus to damage "you deal". A Classic assumption would treat it as a raid debuff. | Excluded as personal. Verify before any change. |
| C6 | Skill line vs spec | Wowhead groups baseline abilities by skill line (for example Blessing of Kings under Protection). Treating that as a spec requirement would be wrong. | Provider is the whole class for baseline abilities. |
| C7 | Heart of the Lion | "All nearby allies" has no range or party/raid wording. | Unverified. |
| C8 | Valor of Azeroth | Raid-wide wording, but how it is obtained and what counts as a "similar long-duration effect" is unknown. | Unverified. |
| C9 | Commanding Shout value | "Stamina by 2" is implausibly low. | Unverified. |
| C10 | Wowhead page header | Pages describe the database as "World of Warcraft: Classic ... patch 1.60.1". The URL path and content are Forever. | Noted. No action. |

## 7. Can the current schema and engine represent these mechanics?

Reported only. No engine change was made.

| Limitation | Effect on this catalog | Suggested follow-up for review |
|---|---|---|
| **Single `spellId`** | Almost every effect has several rank IDs (up to 7). One number cannot preserve them. | Add an optional `spellIds: number[]` (keep `spellId` as the primary). |
| **One provider cannot be shared out across requirements** | A Shaman has four totem slots and one Air totem. Grace of Air, Windfury and Nature Resistance all need the Air slot, but one Shaman would be counted as available for all three. Paladins (one Aura each, one Judgement each), Warlocks (one Curse each), Hunters (one Aspect) have the same issue. The `requirement` count helps for one effect but not across several. | Model provider capacity or exclusive slots (for example an optional `slot` per provider, with the engine assigning players to slots). |
| **Required count cannot depend on composition** | Greater Blessings cover one class each, so the number of Paladins needed depends on how many classes are present. | Possibly derive a requirement from class counts, or leave as `requirement` plus notes. |
| **No rune-engraving or item requirement** | E08, E15, E41, E42, E47, E81, E82 depend on a rune slot. The only unverifiable gate today is `talent`, which means Potential. | Use `talent` text such as "Rune: Cloak" as a stopgap, or add a `requires` type. Needs the owner's view. |
| **No form or stance requirement** | Leader of the Pack needs Cat or Bear form, Moonkin needs Moonkin form, Wild Strikes needs a form. A Feral Druid not in form would still be counted. | Note only. Spec already implies the form for Moonkin and Leader of the Pack. |
| **No range or positioning** | 20 to 45 yard limits (Battle Shout 20 yd). In a 40-player raid not everyone is in range. | Note only. Checklist can only show provider presence. |
| **Alternatives are all equal** | Strength differs by rank and source (Might 133 AP vs Horn). Improved Fortitude changes values. | Accept. The checklist is presence-based. |
| **Exclusivity between different effect families is a single stackGroup** | Works for Horn/Might and Windfury/Wild Strikes. It cannot say "three of these four armor debuffs stack". | Accept. Do not group anything unless the tooltip says so. |
| **Cooldown and consumable effects** | Power Infusion, Innervate, Rallying Cry, Pain Suppression and reagent buffs are time-limited. Coverage is not a static yes or no. | Consider leaving them out of the first catalog or tagging them with `category`. |
| **Party-level data** | Party effects (group-limited totems, auras, Tree of Life) stay "Party Unknown" because party assignments are not tracked. | Already handled by the engine. |
| **`verifiedOn` required for confirmed** | Cannot be satisfied: nothing here is game-verified. | Keep as is. Use `provisional` or `unverified` until checked in game. |

What the schema already handles well: alternative providers (stackGroup), talent-dependent providers (Potential), `requirement` counts, `category`, `notes`, `sources`, confidence and scope status, and party effects reported as Party Unknown.

## 8. Recommended next steps (not started)

1. Owner reviews the Provisional list and decides whether any effect can be promoted after an in-game check (each needs `verifiedOn`).
2. Decide the provider-capacity question (one Shaman, four totems) before adding many totem or aura entries. It is the largest accuracy risk.
3. Decide whether to add `spellIds: number[]`.
4. Decide whether rune-engraving effects, cooldown effects and low-value utility (Thorns, Amplify and Dampen Magic) belong in the first catalog.
5. Verify in game: Trueshot ranks, Moonkin and Leader of the Pack stacking, armor-debuff stacking (R25), resistance overlaps, mana-regeneration stacking, Heart of the Lion scope, Valor of Azeroth.
6. Only after that, populate `coverageData.ts`. That is out of scope for this phase.

## 9. Provider capacity and simultaneous coverage (research for review)

Status: **research and proposal only**. Nothing here is game-verified, nothing is implemented, and `coverageData.ts` is untouched.

### 9.1 Method and limits

- Sources: the Forever tooltips already collected from `https://www.wowhead.com/forever/spell=<id>` (listed below per group), and the build article `https://www.wowhead.com/forever/news/many-buffs-now-raid-wide-class-changes-in-latest-wow-forever-build-383456`. I searched every collected tooltip for exclusivity wording ("only one", "at any one time", "per Paladin", "exclusive", "may not be combined", "same time"). 97 tooltips matched.
- Wowhead started returning HTTP 403 partway through this follow-up, so I could not re-fetch spell pages to look for a separate totem-category field. Where a mechanic is not stated in a tooltip it is marked **Uncertain**, not filled in from Classic memory.
- **Spell availability is not simultaneous coverage.** A class having a spell tells us who could cast it; the tables below ask whether one character can have several of these effects running at once.
- Labels: **Stated** (Forever tooltip says so), **Implied** (Forever tooltip wording suggests it), **Uncertain** (no Forever source; Classic recall only, not for use in the catalog).

### 9.2 Findings by group

#### Shaman totems

| Question | Finding | Basis |
|---|---|---|
| Is there any per-slot wording on totem tooltips? | **No.** None of the totem tooltips (Strength of Earth 8075, Grace of Air 8835, Windfury 8512, Flametongue 8227, Fire Resistance 8184, Frost Resistance 8181, Nature Resistance 10595, Mana Spring 5675, Healing Stream 5394, Stoneskin 8071, Windwall 15107, Tremor 8143) state a slot or "only one totem" limit. | Tooltips as listed |
| Do element categories exist? | **Implied.** Forever text refers to "your current Fire totem" (Fire Nova rune [410093](https://www.wowhead.com/forever/spell=410093); Fire Nova [408341](https://www.wowhead.com/forever/spell=408341) "your active Fire totem"), "your Fire Totems" (Call of Flame [16038](https://www.wowhead.com/forever/spell=16038)), and "your active totems" (Totemic Projection [437009](https://www.wowhead.com/forever/spell=437009), Totemic Recall [36936](https://www.wowhead.com/forever/spell=36936)). A singular "current Fire totem" suggests one Fire totem at a time. | Tooltips above |
| Which totem sits in which element? | **Uncertain.** Not on any tooltip. Classic recall (Earth: Strength of Earth, Stoneskin, Tremor; Air: Grace of Air, Windfury, Windwall, Nature Resistance; Fire: Flametongue, Searing, Magma, Frost Resistance; Water: Mana Spring, Healing Stream, Fire Resistance, cleansing totems) must not be copied in without confirmation. Several resistance totems are the ones most often misremembered. | none |
| Can one Shaman keep Strength of Earth, Grace of Air, Windfury and Flametongue up together? | **Uncertain.** Only if they occupy four different slots. If Windfury and Grace of Air share a slot, one Shaman can only keep one up. | none |
| Weapon imbues vs. totems | **Stated.** Windfury Weapon [8232](https://www.wowhead.com/forever/spell=8232) and Flametongue Weapon [8024](https://www.wowhead.com/forever/spell=8024): "When applied to main hand, disables any benefit you personally receive from [the matching] Totem". This affects only the Shaman's own benefit, not the raid. | Tooltips above |
| Newly raid-wide totems (build article) | **Stated.** Fire Resistance, Flametongue, Grace of Air, Strength of Earth, Windfury are now "party or raid". Range is still 30 yd on each. | Build article |
| Mana Tide Totem [16190](https://www.wowhead.com/forever/spell=16190) | 12 sec duration, "group members". Temporary and group-scoped, so poor coverage material. | Tooltip |
| Two Shamans, same totem | **Uncertain.** Whether two Shamans' identical totems stack or the strongest applies is not stated. Treat them as the same requirement with alternative providers (the current stackGroup rule). | none |

Result: the totem slot problem is **real but not provable from Wowhead tooltips**. A slot table needs a Forever source (in-game check, or the design owner).

#### Paladin auras and blessings

| Question | Finding | Basis |
|---|---|---|
| One Paladin, several auras at once | **Stated: no.** "Players may only have one Aura on them per Paladin at any one time." Devotion [465](https://www.wowhead.com/forever/spell=465), Retribution [7294](https://www.wowhead.com/forever/spell=7294), Concentration [19746](https://www.wowhead.com/forever/spell=19746), Shadow Resistance [19876](https://www.wowhead.com/forever/spell=19876), Frost Resistance [19888](https://www.wowhead.com/forever/spell=19888), Fire Resistance [19891](https://www.wowhead.com/forever/spell=19891). So one Paladin = one aura per player. | Tooltips above |
| Several Paladins, different auras | **Stated (by the "per Paladin" wording).** A player can hold one aura from each Paladin, so extra Paladins add auras. Different Paladins with the same aura: **Uncertain** (stack or highest wins). | Tooltips above |
| Blessings | **Stated.** "Players may only have one Blessing on them per Paladin at any one time" on Might [19740](https://www.wowhead.com/forever/spell=19740), Wisdom [19742](https://www.wowhead.com/forever/spell=19742), Kings [20217](https://www.wowhead.com/forever/spell=20217), Light [19977](https://www.wowhead.com/forever/spell=19977), Freedom, Sacrifice, Protection, and all four Greater Blessings. | Tooltips above |
| Salvation | **Changed in the latest build.** Mass Salvation [25895](https://www.wowhead.com/forever/spell=25895) carries no "one Blessing per Paladin" line, and Revoke [1325499](https://www.wowhead.com/forever/spell=1325499) can remove it. So Salvation is probably **not** in the Paladin's blessing slot. **Uncertain** until the 'no longer exclusive' note is clarified. | Build article, tooltips |
| Greater Blessings | **Stated.** They affect "all members of the raid or group that share the same class with the target". The number of Paladins needed therefore depends on how many different classes are in the raid, not on a fixed count. | Tooltips above |
| Horn of Lordaeron | **Stated.** "Exclusive with Blessing of Might" ([425600](https://www.wowhead.com/forever/spell=425600)): alternative providers in one stackGroup. It does not say Horn occupies the Paladin's blessing slot. **Uncertain.** | Tooltip |
| Judgements and Seals | **Stated.** "Only one Seal can be active on the Paladin at any one time" and "Only one Judgement per Paladin can be active at any one time" (Seal of the Crusader, Justice, Light, Wisdom). So one Paladin keeps one Judgement up on a target. | Tooltips above |
| Aura Mastery rune [416037](https://www.wowhead.com/forever/spell=416037) | The tooltip text is empty. Whether it lets a Paladin run auras simultaneously is **Uncertain**. | Tooltip |
| Sacred Shield [412019](https://www.wowhead.com/forever/spell=412019) | **Stated.** One target at a time. Not a coverage effect. | Tooltip |

#### Warlock curses and banes

| Question | Finding | Basis |
|---|---|---|
| One Warlock, several curses on the same target | **Stated: no.** "Only one Curse per Warlock can be active on any one target." Weakness [702](https://www.wowhead.com/forever/spell=702), Recklessness [704](https://www.wowhead.com/forever/spell=704), Tongues [1714](https://www.wowhead.com/forever/spell=1714), Elements [440892](https://www.wowhead.com/forever/spell=440892), Exhaustion [18223](https://www.wowhead.com/forever/spell=18223). | Tooltips above |
| Banes | **Stated.** Same rule: "Only one Bane per Warlock ... on any one target" (Doom [603](https://www.wowhead.com/forever/spell=603), Agony [980](https://www.wowhead.com/forever/spell=980), Havoc [1225228](https://www.wowhead.com/forever/spell=1225228)). Curses and Banes are separate categories on the tooltips. | Tooltips above |
| Different Warlocks, different curses | **Uncertain** but consistent with the per-Warlock wording. Needs separate Warlocks for Elements, Recklessness, Tongues on one boss. | Wording |
| Same curse from two Warlocks | **Uncertain.** | none |
| Curse of the Elements | The Forever tooltip folds the Classic Elements, Shadow-type effect into one: -75 Magic resistances and +10% Magic damage taken. **Curse of Shadow was not found** in the Forever list. | Tooltip |
| Single-target assumption | The limit is "per target". For a single boss, one Warlock = one curse. With adds, one Warlock could curse several targets. The checklist should assume a single main target. | Wording |

#### Hunter aspects and other exclusives

| Question | Finding | Basis |
|---|---|---|
| Aspects | **Stated.** "Only one Aspect can be active at a time." (Hawk [13165](https://www.wowhead.com/forever/spell=13165), Wild [20043](https://www.wowhead.com/forever/spell=20043), Viper [415423](https://www.wowhead.com/forever/spell=415423), Cheetah, Pack, Beast, Monkey, Falcon). Only **Aspect of the Wild** reaches others ("party and raid ... within 30 yards"). A Hunter who gives Nature resistance therefore forgoes Hawk or Viper. | Tooltips above |
| Trueshot Aura [1299346](https://www.wowhead.com/forever/spell=1299346) etc. | No "only one aura" wording. Whether it competes with Aspects or anything else is **Uncertain**. | Tooltip |
| Stings | **Stated.** "Only one Sting per Hunter ... on any one target." Not raid coverage. | Tooltips above |
| Traps | **Stated.** One Fire trap, one Frost trap at a time. Not coverage. | Tooltips above |
| Hunter's Mark [1130](https://www.wowhead.com/forever/spell=1130) | No per-Hunter limit is stated. **Uncertain** whether two Hunters' Marks stack. | Tooltip |
| Heart of the Lion [409580](https://www.wowhead.com/forever/spell=409580) | Scope "nearby allies" and any exclusivity are not stated. **Uncertain.** | Tooltip |

#### Other groups that share a provider limit

| Group | Finding | Basis |
|---|---|---|
| Druid forms | A Druid is in one form at a time (inherent, not stated on a tooltip). Moonkin Form [24858](https://www.wowhead.com/forever/spell=24858) (Balance) and Leader of the Pack [17007](https://www.wowhead.com/forever/spell=17007) (Feral) belong to different specs, so one Druid never provides both. Wild Strikes rune [410021](https://www.wowhead.com/forever/spell=410021) and Tree of Life rune [439767](https://www.wowhead.com/forever/spell=439767) also need forms. **Implied.** The build article **removed** the old Moonkin/Leader of the Pack exclusivity wording, so the two now apply together. | Build article, tooltips |
| Mage armors | **Stated.** One Armor per Mage. Self-only, so no coverage impact. | Frost Armor [7301](https://www.wowhead.com/forever/spell=7301) etc. |
| Shaman elemental shield | **Stated.** One Elemental Shield per Shaman. Self-only. | Water Shield [408510](https://www.wowhead.com/forever/spell=408510) |
| Warrior shouts | Battle Shout [5242](https://www.wowhead.com/forever/spell=5242) (raid, 20 yd) and Commanding Shout [403215](https://www.wowhead.com/forever/spell=403215) (party, 30 yd) carry no exclusivity wording. Whether one Warrior can maintain both is **Uncertain** (the engine can already treat them as separate requirements). | Tooltips |
| Priest | Fortitude, Spirit and Shadow Protection (and the Prayer versions) carry no exclusivity wording. A single Priest has no stated limit. | Tooltips |
| Armor debuffs | Sunder Armor [7386](https://www.wowhead.com/forever/spell=7386), Faerie Fire [770](https://www.wowhead.com/forever/spell=770), Curse of Recklessness [704]: no stacking rules stated. Already covered by R25. **Uncertain.** | Tooltips |
| Valor of Azeroth [461475](https://www.wowhead.com/forever/spell=461475) | "May not be combined with similar long-duration effects." Which effects are "similar" is not stated. **Uncertain.** | Tooltip |
| Forever "may not stack" lines | The only other cross-player exclusivity lines found: Horn of Lordaeron vs. Blessing of Might; Wild Strikes vs. Windfury Totem (no effect if the target has the totem); Spirit of the Alpha vs. Loyal Beta (shaman rune, spell id not captured). | Tooltips |

### 9.3 Summary matrix

| Group | One character can maintain together | Needs separate characters | Uncertain |
|---|---|---|---|
| Shaman totems | Different-element totems, if elements exist | Two totems in the same element | Which totem is in which element; whether two Shamans' same totem stack |
| Paladin auras | One aura only | Each extra aura (Devotion, Retribution, Concentration, resistance) | Same aura from two Paladins; Aura Mastery |
| Paladin blessings | One blessing type per player per Paladin | Each extra blessing (Might, Wisdom, Kings, Light) | Whether Salvation and Horn use the blessing slot |
| Paladin judgements | One Judgement | Each extra Judgement | none beyond "single boss" |
| Warlock curses | One curse per target | Each extra curse (Elements, Recklessness, Tongues, Weakness) | Same curse from two Warlocks |
| Hunter aspects | One aspect (so Wild or Hawk, not both) | n/a | Trueshot Aura slot; Hunter's Mark stacking |
| Warrior shouts | Both, not contradicted | n/a | Whether both can run together |
| Druid forms | One form | Moonkin and Leader of the Pack are different specs | Wild Strikes/Tree of Life form conflicts |
| Priest buffs | All, no stated limit | n/a | none |

### 9.4 What the current engine does wrong today

`calculateCoverage` counts a player once **per requirement**, with no memory across requirements. With the current schema:

1. One Paladin is shown as covering Devotion Aura **and** Concentration Aura **and** Fire Resistance Aura.
2. One Warlock is shown as covering Curse of the Elements **and** Recklessness **and** Tongues.
3. One Paladin is shown as covering Might, Wisdom and Kings.
4. A Shaman could cover four same-slot totems if those are one slot.

These would all produce a false **Available**, so any entry in these groups needs the capacity model below before it is used.

### 9.5 Proposed minimum extension (not implemented)

**Schema.** One optional field on the effect, in `types.ts`:

```ts
// Effects sharing a slot compete for the same player: one player can fill one requirement per slot.
// Example keys: "paladin-aura", "paladin-blessing", "warlock-curse".
slot?: string
```

The slot is per **effect**, not per provider, so one entry covers all classes in its group. Slots are only added where a Forever source supports them (Stated rows above): `paladin-aura`, `paladin-blessing`, `paladin-judgement`, `warlock-curse`, `warlock-bane`. Shaman element slots are added only after a source is found. No `slotCapacity` is needed yet: every Stated slot has capacity one.

**Engine.** One new step inside `calculateCoverage`, after matches are computed and before status:

1. For each distinct `slot`, collect the requirements (stackGroups) that use it and the confirmed matches for them.
2. Assign players to requirements so that each player fills **at most one** requirement in that slot and each requirement receives up to its `required` count. This is a small bipartite assignment (a handful of requirements per slot), solved with augmenting-path matching. Ties are broken by catalog order.
3. Do this twice: once with non-talent matches (gives `availableCount`) and once with talent matches included (gives `potentialCount`), so Potential is never counted as Available.
4. Use the assigned counts instead of the raw distinct-player counts for the status. Requirements with no slot keep today's behaviour.

Each `RequirementResult` gains `assigned?: ProviderMatch[]` and a short `slotNote` ("Paladin aura slot is used by Devotion Aura") so the detail panel can explain a Missing result. The strip tiles still read the existing `status`, so no UI change is required for correctness; showing the reason would be a later optional change.

**Not included, on purpose:** per-target curse counts, same-effect-from-two-players stacking, range, and shared slots across classes. Greater Blessing class counts stay a manual `requirement` number for now.

**Tests to add:**
- One Paladin and two aura requirements: one Available, one Missing.
- Two Paladins and two aura requirements: both Available.
- A Paladin who needs a talent for one aura is Potential for that requirement, and does not take the slot from a no-talent provider.
- Two different slots on one player (aura and blessing): both Available.
- No slot set: behaviour unchanged (existing 41 tests keep passing).
- Duplicate player IDs do not fill two requirements.
- Unconfirmed matches never take a slot.

**Estimated size:** about 40-60 lines in the engine, one new type field, validation that `slot` is lowercase-kebab, README note, and about 7 tests.

### 9.6 Decisions needed before implementation

1. Accept `slot?: string` on the effect, with capacity one?
2. Is the Shaman totem element table available from the design owner or an in-game check? Without it, totems stay without a slot and must not be marked confirmed.
3. Should Horn of Lordaeron and Mass Salvation join the blessing slot (currently Uncertain)?
4. Single-boss assumption for curses: accepted?
5. Should an uncovered-because-slot-taken result show as Missing or as a new "Contested" status? The proposal reuses Missing to avoid a new status and UI change.

*Decisions recorded after review:* slot field approved for exploration (capacity one); Shaman totem slots left unresolved; Horn of Lordaeron and Mass Salvation left unresolved; single-target assumption for Warlock curses accepted; a new **Contested** status is preferred over reusing Missing; no order-dependent greedy assignment. Section 10 replaces the proposal in 9.5 and 9.6 item 5.

## 10. Proposal v2: matching-based slots and the Contested status

Status: **design only**. The engine, UI, production catalog and preview are unchanged. The algorithm below was prototyped outside the repository (a throwaway script, not committed) and checked against a brute-force search over every assignment on 3,000 random cases: 0 mismatches, and shuffling requirement order never changed a result.

### 10.1 Does the schema support the real mechanics?

I re-read each tooltip rule against the proposed `slot` field. Two corrections to section 9 come out of this.

| Mechanic | What the tooltip actually says | Fits "one slot, capacity one per player"? |
|---|---|---|
| Paladin aura | "Players may only have one Aura on them **per Paladin**" (recipient-side wording). That one Paladin radiates one aura is **Implied** (auras are party-wide and per-Paladin), not Stated as I wrote in 9.2. Aura Mastery is unknown. | **Yes, provisionally.** Mark the slot `provisional`. |
| Paladin blessing | "one Blessing on them **per Paladin**" (recipient-side). A Paladin can give different blessings to different classes. | **Only for full-raid coverage.** Covering every player with Might, Wisdom and Kings needs three Paladins, so capacity one per player is right for that question. It is pessimistic for class-by-class splits, which v1 does not model. |
| Paladin Judgement | "Only one Judgement per Paladin can be active at any one time." Stated (on Crusader, Justice, Light and Wisdom Seals; Seal of Righteousness, Fury and Command carry only the Seal line). | **Yes**, for the Judgement debuffs. |
| Warlock curse / bane | "Only one Curse (Bane) per Warlock can be active on **any one target**." | **Yes, with the single-target assumption.** A Warlock could curse different targets; v1 assumes one boss. Document in README and panel text. |
| Hunter aspect | "Only one Aspect can be active at a time." Stated, caster-side. | **Yes.** Only Aspect of the Wild affects others, so this slot rarely contends. |
| Shaman totems | No slot wording. | **Not supported.** No slot is defined. Totems get no `slot`. |
| Horn of Lordaeron, Mass Salvation | Unresolved. | **Not supported.** No slot is defined. |

**Schema gaps found, and the v1 rules that avoid them:**

1. **A requirement (stackGroup) can mix effects with and without a slot**, for example armor reduction from Sunder Armor (no slot) and Curse of Recklessness (`warlock-curse`). Rule: players eligible through an unslotted effect are *free* and consume nothing. Only `max(0, required − free players)` units must come from the slot, using slot-eligible players who are not already free.
2. **A requirement mixing two different slots** would let one player be counted through both. Rule: `validateEffects` rejects a stackGroup whose effects use more than one distinct `slot`.
3. **Same player, same requirement through two effects** already counts once (distinct players). Unchanged.
4. **Slot keys span classes.** A slot belongs to an effect, and a player is only eligible through their own class, so a slot key shared by two classes is harmless. Keys should still be kebab-case and class-prefixed by convention (`paladin-aura`).
5. **Capacity is fixed at one per player per slot.** No `slotCapacity` field now. Add one only when a verified mechanic needs it (Aura Mastery would be the first candidate).
6. **Slots are independent.** A Paladin can fill one aura requirement, one blessing requirement and one Judgement requirement at once.
7. **Party-buff and Unverified requirements do not take part** (see 10.5).

Conclusion: the schema extension `slot?: string` on `CoverageEffect` is **sufficient** for the mechanics that have Forever tooltip support, with rules 1 and 2 added to validation. It is deliberately silent on everything unresolved.

### 10.2 Data model

```ts
// types.ts additions (proposed)
type CoverageEffect = {
  // ...existing fields
  // Effects sharing a slot compete for the same player: one player fills at most one requirement per slot.
  // Only set where a Forever source supports it. Example: "paladin-aura", "warlock-curse".
  slot?: string
}

type CoverageStatus = 'available' | 'contested' | 'missing' | 'potential' | 'unverified' | 'party-unknown'

type SlotConflict = {
  slot: string
  // Requirements that cannot all be covered together (one connected group of competing requirements).
  requirementKeys: string[]
  // Different eligible players across those requirements, no talent needed.
  poolSize: number
  // Total player-units those requirements need.
  demand: number
  // Largest number of those units that can be covered at once.
  maxCoverable: number
  // demand - maxCoverable: how many more eligible players would resolve it.
  shortfall: number
  // True when more than one maximum assignment exists (who fills what is not fixed).
  alternativeAssignments: boolean
}

type RequirementResult = {
  // ...existing fields
  slot?: string
  // Present on Contested results.
  conflict?: SlotConflict
  // Talent-dependent players would also compete for the same slot. Informational only.
  potentialSlotConflict?: boolean
}

type CoverageReport = {
  // ...existing fields
  conflicts: SlotConflict[]
}
```

The report never contains "the" assignment. It reports eligibility, counts and conflict groups, so no buff is named as the one to sacrifice.

### 10.3 Algorithm

Per slot, over the **confirmed, non-party** requirements that use it. A requirement has demand `d` (its `required`, reduced by free providers as in rule 1) and an eligible player set `E`.

1. **Individually achievable?** If `|E| < d` the requirement is **Missing** (or Potential, see 10.5). It is removed from the matching so it cannot absorb players.
2. **Maximum simultaneous coverage.** Build a bipartite graph: each remaining requirement expands into `d` unit nodes; each player has capacity one. Let `F` be the maximum matching size (Kuhn or Hopcroft-Karp; sizes are at most ~40 players and ~10 requirements per slot).
3. **Guaranteed test, per requirement `i`.** Recompute the maximum matching with `d_i − 1` units for `i`. If the result is **less than `F`**, every maximum assignment must fully serve `i`: `i` is **guaranteed** (Available). If it equals `F`, some maximum assignment leaves `i` short: `i` is **Contested**.
   - If `F = Σd` every requirement is guaranteed, so nothing is Contested.
   - This does not depend on requirement order, player order or catalog order. A greedy fill is never used.
4. **Conflict groups.** Take the Contested requirements and join those that share an eligible player (connected components of the graph). For each component: `demand = Σd`, `maxCoverable` = its matching size, `shortfall = demand − maxCoverable`, `poolSize` = distinct players. The explanation names every requirement in the group equally.
5. **Alternative assignments.** After finding one maximum matching, for each matched edge forbid it and re-run; if the matching size is unchanged, another assignment exists. This produces only the `alternativeAssignments` flag; it is not displayed as a list.
6. **Two passes.** Steps 1–5 run on the no-talent graph (gives Available / Contested). A second run with talent-dependent players included decides whether a non-achievable requirement is Potential (10.5) and fills `potentialSlotConflict`.
7. Requirements with no `slot` skip all this and behave exactly as today.

**Why not greedy:** a greedy pass gives different answers when two requirements are swapped in the catalog, and silently picks which buff loses. The guaranteed test above only asks a yes/no question that has one correct answer.

**Cost note:** guaranteed is O(requirements) matchings per slot per team. With the 10/20/40 raid views it is a few dozen tiny matchings; negligible.

### 10.4 Worked examples

`F` is the maximum number of units covered at once. All players listed are eligible without a talent.

| # | Setup | F | Result | Explanation |
|---|---|---|---|---|
| E1 | Devotion, Concentration and Fire Resistance Aura; two Paladins, each can do any aura | 2 of 3 | **All three Contested** | At most two of three can be covered. Which two is not determined. Shortfall 1: one more Paladin resolves it. |
| E2 | Same, three Paladins | 3 of 3 | **All Available** | |
| E3 | A can use X or Y; B and C can only use Y | 2 of 3 | A Available, B and C Contested | A can always take X. B and C compete for Y alone. |
| E4 | A and B both only P1 | 1 of 2 | Both Contested | Each is achievable alone; not together. |
| E5 | A needs 2 from {P1,P2,P3}; B needs 1 from {P1} | 3 of 3 | Both Available | A can take P2 and P3. |
| E6 | A needs 2 from {P1,P2}; B needs 1 from {P1,P2} | 2 of 3 | Both Contested | Demand 3, pool 2. |
| E7 | A needs 2 from {P1}; B needs 1 from {P1} | 1 of 1 | A **Missing**, B Available | A cannot be met alone, so it takes nothing from B. |

All seven were produced by the prototype and match brute-force enumeration.

### 10.5 Interaction with the other statuses

Order of evaluation for a requirement (first match wins):

| Step | Condition | Status | Notes |
|---|---|---|---|
| 1 | No confirmed effect | **Unverified** | Unverified effects never take a slot and never block one. Confirmed neighbours may therefore look better than reality if an unverified effect is later confirmed; the panel should say so. |
| 2 | All confirmed effects are party buffs | **Party Unknown** | Excluded from matching: party membership is unknown, so we cannot tell which aura a given player's party would need. Several Paladin auras are party-wide, so this is a known limitation. A detail note ("shares the Paladin aura slot") is optional later. |
| 3 | Fewer eligible players than required, even counting talent players | **Missing** | Means no sufficient eligible provider. Never Contested. |
| 4 | Enough no-talent players, and guaranteed in the matching | **Available** | |
| 5 | Enough no-talent players, but not guaranteed | **Contested** | Providers exist, simultaneous coverage is not guaranteed. A talent provider might resolve it; the panel can mention this via `potentialSlotConflict`, but the status stays Contested. |
| 6 | Not enough no-talent players, enough with talent players | **Potential** | A conflict among talent players is shown only as `potentialSlotConflict`. Potential already means "not guaranteed". |

Consequences: Contested never hides a Missing result; Potential never upgrades to Contested; Party Unknown and Unverified always win over Contested; talent players are never allowed to satisfy or protect an Available result.

**Summary and header text:** add a `contested` count (for example "3 available, 2 contested, 1 missing"). `confirmedCount` is unchanged (everything except Unverified).

**UI impact (not done now):** `CoverageStatus` gains a member, so the summary record, label and glyph maps in `coverageDisplay.ts`, the strip and panel styles, and `summaryText` each need an entry. Suggested visual: its own colour distinct from amber (Potential) and red, plus a glyph such as "!" or "≠". The tile tooltip would read, for example, "Contested: 3 requirements need Paladin auras; 2 eligible Paladins".

### 10.6 Test cases for the future implementation

Pure-function tests in `tests/raid-coverage/`:

1. **No slot set:** results identical to today (existing 41 tests keep passing).
2. **E1:** 2 Paladins, 3 aura requirements: all Contested, `shortfall` 1, `maxCoverable` 2, `alternativeAssignments` true.
3. **E2:** 3 Paladins, 3 aura requirements: all Available, no conflicts.
4. **E3:** the asymmetric case: A Available, B and C Contested.
5. **E4:** single provider, two requirements: both Contested; neither is named the loser.
6. **E5/E6:** `requirement` greater than 1 inside a slot.
7. **E7:** a requirement that cannot be met alone is Missing and does not make a neighbour Contested.
8. **Order independence:** shuffle the effect order and the player order; statuses and conflict groups are identical.
9. **Brute-force cross-check:** a small randomized test comparing the engine to an exhaustive search on up to 4 players and 4 requirements, with a fixed seed.
10. **Different slots do not compete:** one Paladin fills an aura, a blessing and a Judgement requirement; all Available.
11. **Talent:** requirement achievable only through a talent player is Potential, not Contested; a talent player never rescues a Contested result; `potentialSlotConflict` is set when talent players would compete.
12. **Unconfirmed matches:** a provisional or unverified effect in the same slot neither takes a slot nor causes Contested.
13. **Party Unknown:** a party-buff requirement in a shared slot stays Party Unknown and does not affect others.
14. **Mixed free and slotted providers:** a Warrior (unslotted Sunder Armor) satisfies an armor requirement even when the Warlock curse slot is contested.
15. **Duplicate player IDs** do not fill two units.
16. **Empty team and empty catalog:** unchanged empty states.
17. **Validation:** a stackGroup mixing two distinct slots is rejected; slot keys must be kebab-case; a slot on an effect with `scopeStatus` unknown produces a warning.
18. **Mutually exclusive effects in one stackGroup** (Horn of Lordaeron vs Blessing of Might) still count as one requirement with no slot, since that slot is unresolved.

Estimated size: about 80–120 lines in a new `slotMatching.ts` (kept separate from `calculateCoverage.ts`), small additions to types, display and README, and about 18 tests.

### 10.7 Still unresolved (no slot defined, nothing assumed)

- Shaman totem slots and element categories (no Forever evidence).
- Horn of Lordaeron and Mass Salvation interaction with the blessing slot.
- Whether two players' identical effects (two Paladins with the same aura, two Warlocks with the same curse) stack.
- Aura Mastery behaviour.
- Whether Trueshot Aura or Hunter's Mark share any limit.
- Class-by-class blessing splits (the model assumes full-raid coverage per blessing type).
- Multi-target curses.

### 10.8 Decisions needed before implementation

1. Approve the guaranteed-in-every-maximum-assignment definition of Contested (10.3)? It treats every unit of demand equally and never ranks requirements. A weighted or priority variant would reintroduce arbitrary choices.
2. Approve the rule that Party Unknown requirements do not take part in slot matching (10.5, step 2)?
3. Approve rejecting a stackGroup that mixes two distinct slots (10.1, rule 2)?
4. Should slotted **targeted** buffs (such as blessings) take part in matching in v1, or only raid buffs and debuffs? The proposal includes them with the full-raid-coverage semantics above.
5. Preferred Contested colour and glyph.

*Decisions recorded after review (see section 11 for the follow-up finding):* approved with the wording in 11.1; Party Unknown stays out of matching; mixed-slot requirements are rejected; v1 matching covers only raid-wide effects and supported enemy debuffs; Contested is orange with a ↔ glyph.

## 11. Decisions, and unit-level vs requirement-level matching

Status: **design only**. Prototypes ran outside the repository (throwaway scripts, not committed). Engine, UI, `coverageData.ts` and the emulator preview are unchanged.

### 11.1 Decisions recorded

1. **Available** means a requirement is fully served in every maximum assignment *within the modelled constraints*. It is a statement about the model (known providers, known slots, the single-target assumption, no range or cooldown). It is **not** a guarantee that the effect is active in game. README, panel help text and tooltips must say so. **Superseded wording:** the formal definition is now the minimal-infeasible-subset definition in section 12.1; the "maximum assignment" phrasing here is retired. The in-game disclaimer still applies.
2. **Party Unknown** effects stay out of matching until party assignments can be evaluated.
3. A catalog requirement (stackGroup) that mixes incompatible slots is rejected by `validateEffects` in v1.
4. **Scope of matching in v1:** raid-wide effects (`raid-buff`) and supported enemy debuffs (`debuff`). `targeted-buff` and `party-buff` effects remain visible but take no part in slot matching. A `slot` on those kinds is a validation warning and is ignored. This removes the full-raid-coverage caveat for Paladin blessings from 10.1; blessings need recipient-aware modelling first.
5. **Contested** is a distinct status with an **orange border and a ↔ glyph**. Tooltip: "Contested: eligible providers exist, but competing effects cannot all be guaranteed at the same time." Orange sits close to the amber used by Potential, so the glyph must carry the difference, and both light and dark themes need a contrast check at implementation time.

### 11.2 Question: does maximizing covered units handle `requirement` > 1?

**Answer: not reliably.** It never over-claims, but it measures the wrong thing when a requirement needs several providers.

A requirement with `requirement: 2` is satisfied only if **both** providers are present. Half-served is not served. Unit-level matching counts each provider slot as an independent unit, so a half-served requirement still adds to the total and can steer which assignments count as "maximum". Two problems follow.

**Problem A: the definition of "maximum" is an arbitrary objective.** Maximising units, or maximising the number of fully served requirements, are different objectives and give different answers. On 5,716 random cases that contain at least one requirement above 1, "maximise units" and "maximise fully served requirements" gave different Available sets in 677 cases, and "maximise total demand of fully served requirements" versus "maximise the count of fully served requirements" differed in 1,534. Choosing any one of them silently prefers some buffs over others, which the design forbids. With every `requirement` equal to 1 all of them coincide (3,000 of 3,000 cases agreed).

**Problem B: unit-level matching can wrongly report Contested.** It never reports Available when it should be Contested (0 cases in 6,000), but it sometimes reports Contested for a requirement that conflicts with nothing.

**Counterexample (smallest found):**

| Requirement | Eligible players | Needs |
|---|---|---|
| R0 | P0, P1, P2 | 2 |
| R1 | P0 | 1 |
| R2 | P1, P2 | 2 |

- Total demand 5, pool 3, so at most 3 units can be covered.
- Unit-level result: **all three Contested.** One maximum unit assignment gives R0 two players (P0, P1), R2 one (P2) and R1 none, so R1 is left out.
- Requirement-level view: R0 + R2 cannot both be served (4 players needed, 3 exist). But R1 + R0 works (R1 P0, R0 P1 and P2) and R1 + R2 works (R1 P0, R2 P1 and P2). R1 conflicts with nothing and can always be added to any fully served set. The correct answer is **R0 and R2 Contested, R1 Available.**
- The unit-level answer was produced only by an assignment in which R0 and R2 are both half-served, which nobody would count as coverage.

A second illustration: R0 needs 2 from {P0, P1}, R1 needs 1 from {P0}, R2 needs 1 from {P0, P1}. Maximising the *number of fully served requirements* picks {R1, R2} and calls them Available; maximising units calls everything Contested. Either way a conflict exists between R0 and each of the others, so the honest answer is that R0 conflicts with R1 and with R2 and neither choice is neutral. The requirement-level definition below reports all three as Contested.

### 11.3 Proposed solution: requirement-level conflicts (all-or-nothing)

The smallest safe change keeps the meaning of Available (fully served in every maximum assignment) but evaluates it at the level of whole requirements, with "maximum" meaning *cannot be extended by another requirement*, not "largest by some score".

**Definitions**

- A set of requirements is **feasible** if all of them can be fully served at once: every requirement gets its required number of distinct eligible players, and each player is used at most once. Feasibility is one bipartite matching (the same Kuhn code as before) and succeeds when the matching size equals the total demand.
- Feasible sets are closed downwards: any subset of a feasible set is feasible.
- A **conflict** is a *minimal infeasible* set: it cannot be served together, but any proper subset can.
- A requirement is **Contested** if it belongs to at least one conflict. Otherwise it is **Available**.

Equivalent statement (superseded, see section 12.1): this paragraph described Available as membership in every maximal feasible set. The adopted definition is the minimal-infeasible-subset one; the two are mathematically equivalent (12.2) but only the minimal-infeasible-subset wording is used from here on.

**Fits the earlier rules:** requirements that are not achievable alone (fewer eligible players than demand) are Missing and are removed first; Party Unknown, Unverified, targeted and party effects are outside matching; talent players are excluded from the Available pass and used only for the Potential pass (10.5).

**Explanations come for free.** Each conflict is a list of requirements with its shortfall (their total demand minus the largest number of units they could jointly cover), which reads naturally: "Devotion Aura and Fire Resistance Aura cannot both be served by 1 Paladin." The panel can list the conflicts a requirement belongs to without ranking them.

**Results for the earlier examples**

| Case | Unit-level (10.3) | Requirement-level (proposed) |
|---|---|---|
| E1 three auras, two Paladins | all Contested | all Contested (three pair conflicts) |
| E2 three auras, three Paladins | all Available | all Available |
| E3 A{X,Y}, B{Y}, C{Y} | A Available, B and C Contested | same (conflict is {B, C}) |
| E4 A{P1}, B{P1} | both Contested | same |
| E5 A needs 2 of {P1,P2,P3}, B{P1} | both Available | same |
| E6 A needs 2 of {P1,P2}, B{P1,P2} | both Contested | same |
| E7 A needs 2 of {P1}, B{P1} | A Missing, B Available | same |
| **E8** R0 (2 of P0,P1,P2), R1 (P0), R2 (2 of P1,P2) | all Contested (wrong) | **R0, R2 Contested; R1 Available** |

**Evidence.** Against a brute-force reference ("a requirement is Available iff every feasible set can be extended with it"), the conflict definition produced **0 mismatches in 6,000 random cases** and shuffling input order never changed a result. Against the unit-level version it matched in all 3,000 cases where every requirement is 1, and in the remaining cases it was **never more optimistic** (0 cases where unit said Available but conflict said Contested) and **less pessimistic in 250 of 6,000**, all of the E8 kind. The unit-level result is therefore a safe fallback but sometimes too cautious.

**Does this silently change the meaning of Available?** No. The meaning stays "served in every maximum assignment, within the modelled constraints". Only the computation changes, because the unit-level version modelled a partly served requirement as progress, which is not how a buff requirement works. The owner should still confirm the "maximal feasible set" reading explicitly (decision 11.6 below), since 10.8 item 1 was approved on the unit-level wording.

### 11.4 Cost and limits

Enumerating minimal conflicts is exponential in the number of requirements *per slot*. Realistic slots are small: Paladin aura six at most, Warlock curse about five, Paladin Judgement four, Hunter aspect rarely contended. That is at most about 64 subsets of tiny matchings per slot per team, which is negligible.

Safeguard (**withdrawn by decision, see section 12.5**): the earlier proposal to fall back to the unit-level result above 10 live requirements is rejected, because that result can be wrong. Section 12 replaces it with an exact algorithm and an explicit indeterminate result.

### 11.5 Revised data model

```ts
type SlotConflict = {
  slot: string
  // A minimal set of requirements that cannot all be served together.
  requirementKeys: string[]
  // Total players those requirements need.
  demand: number
  // Largest number of their units that can be covered at once.
  maxCoverable: number
  // demand - maxCoverable.
  shortfall: number
}

type RequirementResult = {
  // ...existing fields
  slot?: string
  // Every conflict this requirement belongs to. Present only on Contested results.
  conflicts?: SlotConflict[]
  // Talent-dependent players would also compete for the same slot. Informational only.
  potentialSlotConflict?: boolean
}

type CoverageReport = {
  // ...existing fields
  conflicts: SlotConflict[]
}
```

This replaces `poolSize`, `alternativeAssignments` and the connected-component grouping from 10.2. A conflict names every member equally and never nominates a requirement to sacrifice.

### 11.6 Test cases added

On top of the 18 in 10.6 (items 2 to 7 gain the revised conflict output):

19. **E8 counterexample:** R0 needs 2 of {P0,P1,P2}, R1 needs 1 of {P0}, R2 needs 2 of {P1,P2}. R1 Available, R0 and R2 Contested, one conflict `{R0, R2}` with shortfall 1.
20. **Half-served does not count:** R0 needs 2 of {P0,P1}, R1 needs 1 of {P0}, R2 needs 1 of {P0,P1}. All three Contested, with conflicts `{R0,R1}` and `{R0,R2}`.
21. **`requirement` above 1 inside a slot with enough providers:** every requirement Available and no conflicts (E5).
22. **Objective independence:** result is identical to a brute-force reference that checks "can this requirement be added to every feasible set" on a fixed-seed random batch with `requirement` up to 3.
23. **All-ones equivalence:** with every `requirement` equal to 1, the result equals the unit-level result (guards against regressions from the earlier design).
24. **Order independence:** shuffling effects, players, and the order in which the requirement keys are listed leaves statuses and conflict sets unchanged.
25. **Missing is removed first:** a requirement that is unachievable alone neither causes nor joins a conflict (E7).
26. **Size guard (superseded by 12.7 tests 6 to 8):** replaced by the node-limit behaviour; there is no unit-level fallback.
27. **Scope guard:** a `slot` on a `targeted-buff` or `party-buff` effect is ignored and produces a warning; the effect never appears in a conflict.
28. **Minimality:** the reported conflicts never contain a feasible subset (for example `{A, B, C}` is not reported when `{B, C}` is a conflict).

### 11.7 Decisions still needed before implementation

1. Approve the requirement-level reading of Available (in every maximal feasible set, equivalently in no conflict) as the way to evaluate decision 11.1, replacing the unit-level computation in 10.3?
2. Approve the fallback to the unit-level result, with a warning, for slots with more than 10 live requirements?
3. Confirm Contested colour values. Orange is close to the existing amber, so I suggest keeping the glyph visible in every theme and a different border style only if the contrast check in the preview shows the two are hard to tell apart.

*Decisions recorded after review:* conflict-based classification approved using the minimal-infeasible-subset definition (12.1); the unit-level fallback is rejected in favour of an exact algorithm with an explicit indeterminate result (12.5); orange border and ↔ glyph approved, with contrast verified in the preview.

## 12. Exact classification: definition, proof, algorithm, performance and limits

Status: **design only**. Prototype and tests ran outside the repository (Node scripts, not committed). Engine, UI, `coverageData.ts` and the emulator preview are unchanged.

### 12.1 Definition (the one to use everywhere)

Work with the **modelled requirements** of one slot: confirmed, non-party, raid-wide or enemy-debuff requirements (decision 11.1 item 4), counting only providers that need no talent. A set of requirements is **feasible** if every requirement in it can be given its required number of *different* eligible players, with no player used twice. A set is **infeasible** otherwise. A **minimal infeasible subset** (a *conflict*, also called a circuit) is an infeasible set all of whose proper subsets are feasible.

| Status | Definition |
|---|---|
| **Missing** | Fewer eligible providers than the requirement needs, even considered individually (a one-element set is infeasible). Never Contested. |
| **Contested** | Individually achievable, and belongs to at least one minimal infeasible subset of the modelled requirements. |
| **Available** | Individually achievable, and belongs to no minimal infeasible subset of the modelled requirements. |

Missing requirements are removed before the other two are evaluated, so they neither cause nor join conflicts. The in-game disclaimer from 11.1 still applies: Available is "no modelled conflict", not "active in game".

### 12.2 Mathematical confirmation

**Claim 1: the definition is order-free and objective-free.** Feasibility depends only on the set of requirements and on the eligibility lists, so whether a set is a minimal infeasible subset cannot depend on catalog order, player order or any scoring.

**Claim 2: no conflict means every feasible set can be extended.** Suppose R is individually achievable and in no minimal infeasible subset. Take any feasible set S not containing R. If S ∪ {R} were infeasible it would contain a minimal infeasible subset. That subset cannot lie inside S (S is feasible), so it contains R, contradicting the assumption. So S ∪ {R} is feasible.

**Claim 3: feasible sets are closed downward** (removing a requirement frees players and never hurts), so this reasoning holds without any matroid property. Requirements with demand above 1 break the matroid property, but Claim 2 does not use it.

**Claim 4: equivalence with the earlier wording.** The converse also holds: if R is in a conflict C, extend C \ {R} (feasible) to a maximal feasible set M; M cannot contain R, because then C ⊆ M would be infeasible. So "in no conflict" is the same as "in every maximal feasible set". The two phrasings are equivalent; the document uses only the conflict phrasing, as decided.

**Claim 5: the unit-level approach of section 10 is not equivalent** and is retired, as shown by the E8 counterexample in 11.2.

**Evidence against exhaustive reference.** The reference enumerates every subset, finds every minimal infeasible subset directly from the definition, and classifies from that. Over **8,000 random cases** (2 to 8 requirements, 2 to 8 players, demand 1 to 3, varied eligibility density; 18,991 Contested results among them):

- 0 mismatches between the algorithm in 12.4 and the reference.
- 0 disagreements between the conflict definition and the "every maximal feasible set" definition, confirming Claim 4 empirically.
- 0 invalid witness conflicts (each reported witness was verified to be infeasible with every proper subset feasible, and to contain the requirement it explains).
- 0 order-dependent results when requirements were shuffled.

### 12.3 Is enumerating every minimal infeasible subset necessary?

**For classification: no.** R is Contested exactly when some feasible set S not containing R becomes infeasible when R is added. One such S suffices: shrink S ∪ {R} by removing elements of S while it stays infeasible, and what remains is a conflict that contains R. That single **witness conflict** proves Contested, and it also proves Contested for every other member of the witness. Available needs the opposite proof (no such S exists), which is a search, but never a listing of conflicts.

**For explanations: not all of them, and not by default.** One witness per Contested requirement is enough to say "Devotion Aura and Fire Resistance Aura cannot both be served by one Paladin", with `demand`, `maxCoverable` and `shortfall`. Listing every conflict grows quickly. Measured on random slot groups (200,000-node cap):

| Requirements, players | Worst nodes to list all conflicts | Most conflicts | Capped |
|---|---|---|---|
| 6, 8 | 62 | 11 | 0/30 |
| 10, 12 | 972 | 136 | 0/30 |
| 14, 14 | 12,951 | 1,762 | 0/30 |
| 18, 16 | 200,001 | 23,911 | 1/30 |
| 24, 20 | 200,001 | 101,336 | 30/30 |

Conclusion: classification uses the cheap witness search; the panel shows one witness conflict per requirement. "Show all conflicts" is optional, off by default, and always capped (and labelled "more conflicts exist" when capped).

### 12.4 Exact algorithm (prototype, in Node)

Inputs per slot: modelled requirements with their eligible-player sets and demands.

1. **Missing:** drop requirements with fewer eligible players than demand (they are Missing).
2. **Components:** group the remaining requirements by shared eligible players (union-find). A conflict can only exist inside one component, so components are solved independently.
3. **Fast path:** if the whole component is feasible (one bipartite matching), every requirement in it is **Available**. This is the usual case and costs one matching.
4. Otherwise, for each requirement R in the component not already explained by a witness, search for a feasible set S of the other requirements with S ∪ {R} infeasible, depth-first over feasible subsets:
   - If S ∪ {R} is infeasible: found. Shrink to a minimal infeasible subset (the witness); mark all its members **Contested** with that witness.
   - **Prune** a branch when S plus all not-yet-considered others plus R is feasible: no extension of that branch can block R, because feasibility is closed downward.
   - Feasibility results are cached by requirement set.
5. If the search finishes without finding S, R is **Available**. If it runs past the node limit (12.5), R is **Indeterminate**.

Feasibility is a bipartite matching (the existing Kuhn matching, players on one side, demand units on the other) and is exact. All 40 players fit comfortably.

**Soundness properties** (relied on by the limit handling):

- A **Contested** result always carries a witness and is **never wrong**, even if other requirements hit the limit.
- An **Available** result is produced only by a completed search or the fast path, so it is **never wrong**.
- Only requirements that could be neither proven Contested nor proven Available within the limit are Indeterminate.

### 12.5 Performance measurements

Node 24 on the development machine, single thread, 20,000-node limit per requirement. The real engine is TypeScript and would be of the same order, but these are prototype numbers, not engine benchmarks.

| Scenario (random eligibility) | Avg time | Worst time | Max search nodes | Indeterminate |
|---|---|---|---|---|
| Realistic: 6 requirements, 4 providers, demand up to 2 | 0.017 ms | 0.34 ms | 31 | 0 of 12,000 |
| Realistic: 6 requirements, 10 players, demand up to 2 | 0.009 ms | 0.27 ms | 76 | 0 of 12,000 |
| Larger: 10 requirements, 12 players, demand up to 3 | 0.107 ms | 1.24 ms | 285 | 0 of 5,000 |
| Larger: 16 requirements, 16 players | 0.287 ms | 0.89 ms | 72 | 0 of 4,800 |
| Larger: 24 requirements, 20 players | 0.82 ms | 1.48 ms | 150 | 0 of 2,400 |
| Larger: 28 requirements, 40 players | 5.6 ms | 8.3 ms | 210 | 0 of 1,400 |

Real Forever slots are far smaller than these (Paladin aura six candidate requirements at most, Warlock curse about five), so the realistic row is the relevant one.

**A deliberately hard case.** One requirement R needs 1 player; twenty others each need 3; all share one pool. With pool 31, R is Available (the best the others can reach is 30, and 30 + 1 fits), so the search must prove that no blocking subset exists. That is a subset-sum shape:

| Pool | Result with a 20,000-node limit | Result with a 200,000-node limit |
|---|---|---|
| 7 (eight others) | R Available, 54 nodes, under 1 ms | same |
| 16 | R **Indeterminate**, about 0.8 s; the other 20 requirements Contested | R Available, about 20,400 nodes, 0.9 s |
| 22 | R **Indeterminate**, about 1.4 s | R Available, about 116,000 nodes, 6.8 s |
| 31 | R **Indeterminate**, about 1.7 s | not run (it would exceed the budget by far) |

So the search is exact but not polynomial. It is fast on every realistic or randomly generated case, and the hard cases are artificial: many interchangeable requirements over one big pool. Merging requirements with identical eligibility and demand (a symmetry reduction) would collapse these cases, and is listed as a possible follow-up, not needed for v1.

**Lesson recorded from the prototype:** the limit must be **per requirement**, not shared across a component. A shared limit let one hard requirement turn every later requirement into Indeterminate even though they were cheap to prove Contested. With a per-requirement limit the example above leaves only R Indeterminate and the other twenty correctly Contested.

### 12.6 Calculation limits and Indeterminate results

**Limit.** A deterministic count of search nodes **per requirement**, not wall-clock time, so results are reproducible and testable. Proposed default **20,000 nodes**, a named constant in the calculation module. With the measurements above that costs roughly one second of CPU in the worst case per requirement, and zero in every realistic case. The limit also bounds the total work: no more than `limit × requirements-in-slot` nodes.

**Rule: never guess.** If the search for a requirement does not finish, its result is **Indeterminate**. It is never shown as Available, Contested or Missing.

**Representation (proposal for implementation):**

```ts
// CoverageStatus gains one member
type CoverageStatus = 'available' | 'contested' | 'missing' | 'potential' | 'unverified' | 'party-unknown' | 'indeterminate'

type RequirementResult = {
  // ...existing fields
  // Why a calculation could not finish; present only on Indeterminate results.
  limitReason?: { slot: string; nodeLimit: number; nodesUsed: number }
}

type CoverageReport = {
  // ...existing fields
  // True when any requirement is Indeterminate, so UI and tests can warn without scanning.
  hasIndeterminate: boolean
}
```

**Display (not yet built).** Label "Not calculated", gray dashed border like Unverified but with a distinct ⚠ glyph, and tooltip "Too many competing effects to check within the limit; this requirement is neither confirmed nor ruled out." Placeholder choice, to be confirmed at preview time with the other status styles. Summary text adds an "indeterminate" count only when it is above zero.

**Interactions:**

| Situation | Behaviour |
|---|---|
| Indeterminate and Missing | Missing is decided before any search and is never Indeterminate. |
| Indeterminate and Potential | Evaluated per pass. If the no-talent pass is Indeterminate the requirement is Indeterminate, not Potential, because Potential means "achievable if a talent is taken" and that cannot be claimed while Available or Contested is open. Missing and Potential decisions that do not depend on the slot search are unchanged. |
| Indeterminate and Party Unknown / Unverified | Both are decided earlier and win, as for Contested. |
| Other requirements in the same slot | Unaffected: soundness (12.4) means every decided result stays correct. |
| Catalog warning | `validateEffects` adds a warning when one slot has more than 12 raid or debuff requirements, as a review hint. It does not change any result. |
| Strip tiles | An Indeterminate requirement shows its own tile style, so it cannot be mistaken for Available or Contested. |
| Developer visibility | The panel header notes "N requirement(s) not calculated" when `hasIndeterminate` is true. |

A code failure (unexpected exception) is not an Indeterminate result: it must surface as an error in the panel rather than being swallowed.

### 12.7 Revised test cases for implementation

These replace and extend 19 to 28 in section 11.6. Where the same property appears, the version below is the one to use.

1. **Definition tests:** E1, E2, E3, E4, E5, E6, E7 and E8 from 10.4 and 11.3 with their conflict-based statuses.
2. **E8:** R0 needs 2 of {P0,P1,P2}, R1 needs 1 of {P0}, R2 needs 2 of {P1,P2}: R1 Available, R0 and R2 Contested, witness `{R0, R2}`.
3. **Half-served does not count:** R0 needs 2 of {P0,P1}, R1 needs 1 of {P0}, R2 needs 1 of {P0,P1}: all Contested; witnesses `{R0,R1}` and `{R0,R2}`.
4. **Exhaustive cross-check:** on a fixed-seed batch (at least 2,000 cases, up to 7 requirements and 7 players, demand up to 3) the engine matches a reference that enumerates every subset and every minimal infeasible subset.
5. **Witness validity:** every reported witness is infeasible, every proper subset is feasible, and it contains the requirement it explains.
6. **Limit: Indeterminate:** with the node limit set low in a test, the hard case (R needs 1, many others need 3, large shared pool) returns Indeterminate for R and never Available or Contested.
7. **Limit: soundness:** in the same case, requirements that can be proven Contested within the limit are still reported Contested; Available is never reported for any Indeterminate case.
8. **Limit: determinism:** the same input and the same limit always give identical results, regardless of effect or player order.
9. **Limit: per-requirement:** one hard requirement does not turn easy ones into Indeterminate.
10. **Missing before search:** an under-supplied requirement is Missing and not Indeterminate even when the slot is large.
11. **Components:** requirements that share no players never conflict, even in the same slot.
12. **Fast path:** a feasible component performs one matching and returns all Available (checked through a counter exposed for tests, or by timing-independent node count).
13. **Order independence:** shuffling effects, players and eligibility lists leaves statuses and conflict sets unchanged.
14. **No slot:** behaviour identical to today; the existing 41 tests pass unchanged.
15. **Scope guard:** a slot on a targeted or party effect is ignored with a validation warning.
16. **Mixed slots:** a stackGroup mixing two slots is rejected by validation.
17. **Talent and unverified providers:** never take part in the Available pass; talent providers can make a requirement Potential but never rescue a Contested or Indeterminate one.
18. **Party Unknown and Unverified:** excluded from matching and never block others.
19. **Duplicate player IDs** do not fill two units.
20. **Empty team and empty catalog** keep their current empty states.
21. **Indeterminate presentation (when the UI is built):** the strip and panel show the "Not calculated" state, never an Available tile, and the summary text mentions it.
22. **Contested presentation (when the UI is built):** orange border and ↔ glyph in light and dark themes, tooltip text as in 11.1, contrast checked in the preview.

### 12.8 Recommendation and remaining decisions

Classification can be implemented with the exact witness search above. No unit-level logic remains in the design. The prototype resolves every realistic case in well under a millisecond and returns an explicit Indeterminate only for artificial, large, symmetric slot groups.

Decisions needed:

1. Accept the per-requirement node limit (default 20,000) and the Indeterminate status with the "Not calculated" label, ⚠ glyph and dashed gray border?
2. Accept that Potential is withheld (Indeterminate shown instead) while the no-talent search is open?
3. Accept one witness conflict per requirement as the default explanation, with "all conflicts" optional and capped?
4. Should the symmetry reduction (merge requirements with identical eligibility and demand) be part of v1 or a later improvement? It is not needed for any realistic slot.
