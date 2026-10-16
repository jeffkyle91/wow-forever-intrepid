# Raid coverage checklist: how to correct a fact

The panel on Raid Teams ("Buff and debuff coverage") is read-only and computed from the players assigned to the selected team. All game facts live in one file, [`coverageData.ts`](./coverageData.ts). Nothing else needs to change.

## Current state

The data file holds 58 researched effects (29 requirements in the standard checklist, 33 in total) taken from Wowhead's WoW Forever pages. **None is confirmed**: 44 are provisional and 14 are unverified, and none has a `verifiedOn` date. The engine counts only confirmed entries for verified results, so verified status is Unverified until an entry is verified in game and promoted. Provisional entries produce clearly labelled **estimates** from the assigned roster (see below); unverified entries are never counted. No entry has a `slot`, because Forever exclusivity rules (Shaman totems, Paladin blessings, curses, auras, aspects) are unresolved. WoW Classic behaviour must not be assumed to match WoW Forever. Research and open questions: `docs/design/Buff-Checklist-Research.md` (local draft).

## Adding or correcting an entry

Each entry in `coverageEffects` has:

| Field | Meaning |
| --- | --- |
| `id`, `name` | Unique id and the label shown. |
| `kind` | `raid-buff`, `party-buff`, `targeted-buff` or `debuff`. |
| `providers` | Who can provide it: `className`, optional `specs` (roster specialization names; omit for any spec; Rogue is **Combat**), optional `talent`, optional `note`. Any one matching provider is enough. See "Specialization eligibility". |
| `stackGroup` | Give effects that do not stack, or replace each other, the same group. They count as one requirement with alternative providers. All entries in a group must have the same `kind`. Only group effects when evidence supports it. |
| `requirement` | Optional minimum number of **different** eligible players. Defaults to 1. Use more than 1 only when a verified mechanic requires it. In a stack group the largest value among its confirmed effects applies. Not allowed on `party-buff` entries. |
| `category`, `spellId` | Optional UI grouping text, and a spell id only where reliably sourced (positive whole number). The spell id also picks the icon (see below). |
| `visibility` | Optional. Omit (or `'standard'`) for the everyday checklist. `'encounter'` keeps researched data out of the checklist for possible future encounter-specific coverage. `'excluded'` hides one effect from the checklist, counts and panel (and from the engine) while keeping its data. Every effect in one `stackGroup` must use the same value, except that `'excluded'` may share a group with standard effects: only that effect leaves, the remaining alternatives stay. An `'encounter'` effect cannot share a group with other values. |
| `confidence` | `confirmed`, `provisional` or `unverified`. |
| `scopeStatus` | `confirmed`, `provisional` or `unknown`: whether who the effect reaches (raid, party, one target, enemy) has been verified for WoW Forever. |
| `sources` | At least one: a link, a patch note, a tooltip or a name. Prefer current WoW Forever material over Classic. |
| `notes`, `verifiedOn` | Optional notes (build or version, caveats). `verifiedOn` is the date (`YYYY-MM-DD`) someone actually checked the game; never invent one. **Confirmed entries require it.** |

Rules of thumb:

- Only `confidence: 'confirmed'` **and** `scopeStatus: 'confirmed'` give a **verified** result. Confirmed means evidence specific to WoW Forever for the providers and the scope. A Classic reference alone is at best `provisional`.
- Source confidence and roster coverage are separate. The engine runs twice: the verified pass counts only confirmed entries (`status`), and the **estimate** pass also counts `provisional` entries whose scope is not `unknown` (`estimate`). `basis` says which applies: `verified` (every counted effect confirmed), `estimated` (some provisional data was used) or `unverified` (nothing estimable). Unverified entries are never counted in either pass and never act as alternatives.
- Estimated Available, Missing, Potential and Contested are labelled "Estimated …" in the strip and panel, drawn with a dashed border and a hollow badge (verified results use a solid border and a filled badge), and the accessible name and detailed panel say the provisional data is not verified in game. Party Unknown, Not calculated and Unverified are never labelled estimated.
- Unsure about something from memory or Classic? Use `confidence: 'unverified'` and `scopeStatus: 'unknown'`.
- Multiple providers of one effect are alternatives for one requirement; a player is counted once however many alternatives they match.
- A `party-buff` always shows **Party Unknown**, because the app does not know who is in which party of five.
- A provider with a `talent` shows **Potential**, because talents are not tracked. Talent, unverified and party providers never satisfy a requirement as **Available**.
- A targeted buff lists eligible providers and how many there are; it never claims everyone is covered.
- With no entries the panel says "No coverage data yet"; with only unverified entries it shows Unverified, and with provisional entries the summary starts with "Estimated:".
- Never put real character names in this file.

## Specialization eligibility

The roster already stores each player's class and specialization, and the engine reads them as they are (no extra fields). For each player and provider rule the result is one of:

| Eligibility | Meaning | Effect on coverage |
|---|---|---|
| Guaranteed | The class (and listed `specs`, if any) can provide it with no talent or rune choice. | Can make a requirement Available. |
| Assumed | A `talent` provider whose spec is named in the provider's explicit `assumed` list (a raid-planning assumption, not a confirmed talent). | Estimated Available only. In the verified result it counts as Possible. |
| Possible | A `talent` or rune is needed, or the player's specialization is blank or not a recognised roster value for the class. | Potential only. |
| Ineligible | A different class, or a recognised specialization that is not in `specs`. | Not counted. |

- `specs` lists which roster specializations can provide the effect. It does **not** make a `talent` provider guaranteed or assumed: picking a spec does not prove the talent or rune was taken.
- `assumed: { specs, basis }` on a provider is the only way to assume a talent. It is per provider and per spec, never inferred from `specs`, and never applied to other talents of that spec. `specs` must be a subset of the provider's `specs`, the provider must have a `talent`, and `basis` (shown in the tooltip) must cite the research. `validateEffects` enforces this.
- An assumed provider can never produce a verified Available. It counts only in the estimate, so such a requirement is always labelled "Estimated", even if the effect itself is confirmed. Assumed providers do take part in slot-conflict checks in the estimate (so they can make a requirement Contested); possible providers never do.
- Enabled assumptions: Feral Druid for Leader of the Pack and Balance Druid for Moonkin Form (the research records both talent trees). **Not assumed:** Guardian Druid for Leader of the Pack (no evidence), Marksmanship Hunter for Trueshot Aura (the research only infers the tree), Mana Tide Totem (unverified), and any rune.
- A provider with `specs` and no `talent` is guaranteed for those specs. Use that only when Forever evidence shows the ability is intrinsic to the spec. **No catalog entry does today.**
- A provider without `specs` is class-wide. Use that for baseline abilities: Wowhead's skill line (for example Blessing of Kings under Protection) is a category, not a spec requirement.
- Blank, misspelled or wrong-class specializations are never trusted to make something Available or to rule a player out; they are Possible. A class that is not in the roster table cannot be checked, so any non-blank spec counts as readable there.
- `validateEffects` rejects an empty `specs` list and a spec that is not a roster specialization for that class.
- This is separate from source confidence: a provisional effect with a resolved spec still shows "Estimated …".
- Tooltips list "Eligible providers", then who is Guaranteed, Assumed, Possible and Not eligible in this team, with specializations named (for example "Feral Druid" and "Restoration Druid ×2" rather than "Druid ×3"). An assumed provider adds "Planning assumption, not a confirmed talent selection or verified Forever mechanic: …" with the catalog's basis.

Current `specs` (all talent-tree effects, so none is guaranteed): Trueshot Aura (Marksmanship, tree inferred), Leader of the Pack (Feral and Guardian, Feral Combat tree; the roster's Guardian mapping is unchecked), Moonkin Form (Balance) and Mana Tide Totem (Restoration, tree inferred, unverified).

**Needs a future talent and rune tracking feature before it can ever be verified Available:** Trueshot Aura, Leader of the Pack, Moonkin Form, Mana Tide Totem, Dark Inspiration, Wild Strikes and Homunculi. Until then they are Potential, except Leader of the Pack (Feral) and Moonkin Form (Balance), which show Estimated Available through the assumptions above.

**Open audit questions (not assumed, so left class-wide):** whether Forever gates some effects recorded as baseline behind a talent, rune or form (for example Divine Spirit and Prayer of Spirit, Blessing of Kings, Demoralizing Roar needing Bear form, and Wild Strikes needing Cat or Bear form). Confirm each in game, then add `talent` and `specs`.

## Check your change

```bash
node --test tests/raid-coverage/*.test.ts
npx tsc -p tests/raid-coverage   # type-check the tests
npm run build
npm run lint
```

The tests include a check that the data file passes `validateEffects` (unique ids, a source on every entry, valid dates, `verifiedOn` on confirmed entries). These tests are not part of `npm run test:rules` and may not run in CI, so run them yourself. Then open Raid Teams in the 10, 20 and 40 views, in light and dark themes, and check the panel and the browser console. Send the change as a feature-branch pull request for review, and do not replace a verified fact with a Classic assumption.

## Re-check schedule

Re-check every entry at the end of the beta (about 2026-10-21 and 22), in launch week, and on 2026-12-09, and update `verifiedOn`.

## Where coverage appears

- **Team card header:** a collapsed-by-default "Buff & debuff coverage" section, with a count per status shown while collapsed. Expanded, it is a grid of spell icons, one per requirement (alternative providers share one representative icon, the first effect that has an icon). The icon border colour and the small badge glyph show the status; the glyph means the state never relies on colour alone. Hovering or focusing an icon shows only the spell's name and its stored Wowhead Forever description (or "Highest-rank spell description unavailable"); Escape dismisses it. The accessible name is "spell name: status". Status, providers, confidence and conflicts are in the border, badge, accessible name and the detailed panel, not in the tooltip.
- **Panel below the teams:** the detailed view with providers, sources, scope and verification. It does not repeat the icon grid.
- Both use the same engine and show only `standard` effects. Encounter-specific effects (currently the Fire, Frost, Nature and Shadow resistance auras and totems, Aspect of the Wild and Priest Shadow Protection) stay in `coverageData.ts` and the research document but are not calculated or shown.
- **Descriptions:** [`spellDescriptions.ts`](./spellDescriptions.ts) holds, for each catalog `spellId`, the spell's highest Forever rank: `tooltipSpellId`, `rank`, `sourceUrl` (its Wowhead Forever page), the name and the description, read on 2026-10-16 so hovering makes no request. The highest rank is the highest rank number listed on the Forever spell page (not the highest spell ID); a spell with no ranks uses its own id and has no `rank`. The text is the Forever tooltip for that rank; where the tooltip carried unresolved formulas (Windfury Totem, Flametongue Totem) the text comes from Wowhead's per-rank Forever change list and is marked `descriptionSource: 'change-list'`. No Classic, TBC or Retail text is used. Three entries (Horn of Lordaeron, Vampiric Touch, Valor of Azeroth) have no description because their data contains unresolved formulas; they show "Highest-rank spell description unavailable" and carry a `reason`, and need review. Add an entry here when you add a `spellId`. The icon stays the catalog spell's icon; the highest ranks use the same icons.
- **Icons:** [`spellIcons.ts`](./spellIcons.ts) maps spell ids to Wowhead icon names (from `nether.wowhead.com/forever/tooltip/spell/<id>`) and builds the `wow.zamimg.com` image URL. Add a line there when you add a `spellId`. A spell with no icon, or an image that fails to load, shows its initials instead. Icons are display only and never affect coverage.

## Status labels

Available, Contested (↔), Missing, Potential (talent needed), Unverified (not confirmed for WoW Forever), Party Unknown (party groups are not tracked) and Not calculated (⚠).

## Slots: effects that compete for the same player

Some effects cannot be maintained together by one character (for example a rule such as "one aura per Paladin"). Give such effects the same optional `slot` (lowercase words joined by hyphens, such as `paladin-aura`). One player can then fill at most one requirement per slot.

- Only add a `slot` when a WoW Forever source supports it. Do not copy Classic rules. The Shaman totem slots, Horn of Lordaeron and Mass Salvation are **unresolved** and must not get a slot until verified.
- Slots apply only to `raid-buff` and `debuff` entries. Party and targeted buffs are never matched, and a slot on them is reported by `validateEffects`.
- All effects in one `stackGroup` must use the same slot. A group may mix slotted and unslotted effects: a player who provides it through an unslotted effect needs no slot.
- Slots are checked in both passes (verified and estimate), using the same exact algorithm. Only providers counted in that pass without a talent take part. Talent, unverified and party providers never compete and never count as Available.
- **Missing**: fewer eligible players than the requirement needs, even on its own.
- **Contested**: it can be met on its own, but it belongs to a minimal set of requirements that cannot all be met at once. The panel names one such set, not every one.
- **Available**: it can be met on its own and belongs to no such set. This means no modelled conflict, not that the effect is active in game.
- **Not calculated**: a valid catalog whose exact check stopped at its limit (20,000 search steps per requirement, or more than 30 competing requirements in one group). The result is unknown, never guessed. Potential is unaffected, because it is decided before any slot search.
- **Catalog error**: an invalid slot setup (a badly named slot, a slot on a party or targeted buff, or two different slots in one `stackGroup`) is a data-file mistake, not a limit. `validateEffects` reports it, and the panel and strip show an error instead of any coverage. It is never shown as Not calculated.
- Status order: Unverified, Party Unknown, Missing/Potential (talent providers counted only for Potential), then Available, Contested or Not calculated from the slot check. Only no-talent, confirmed providers reach the slot check.
- The result does not depend on the order of players or catalog entries. Identical requirements are not merged yet.
