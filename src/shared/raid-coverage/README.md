# Raid coverage checklist: how to correct a fact

The shared panel on Raid Teams and Leadership ("Buff and debuff coverage") is read-only and computed from the players assigned to the selected team, not sign-ups or raid-readiness flags. All game facts live in one file, [`coverageData.ts`](./coverageData.ts). Nothing else needs to change.

Standing teams are independent by size. Coverage selects only that size's assignment collection: `teamAssignments` for 10, `teamAssignments20` for 20, and `teamAssignments40` for 40. Green/Pink/Brown no longer combine Blue/Yellow/Red/White. Missing larger-team assignments mean empty teams, not a fallback to the 10-player roster. Local consumable preferences remain on this device and are scoped to the independent team's key.

## Current state

The data file holds 58 researched effects (25 standard requirements, 35 in total). The catalog is the accepted source of truth for raid planning. The interface evaluates every displayed catalog effect regardless of research confidence and uses normal status labels and solid status borders. Available means an eligible assigned provider exists with no modeled conflict; it does not claim the spell is active or every member receives it.

Research remains internal: 43 effects are provisional, 15 unverified, and none has a `verifiedOn` date. `calculateCoverage` retains its verified and estimated research passes and adds a `planning` result and `planningSummary` from the same eligibility/scope/demand/slot algorithm. Planning accepts all supplied catalog effects; research flags never become UI warnings. Visibility filtering still excludes encounter, excluded and inactive entries. No catalog effect currently has a `slot`. Research and open questions remain in `docs/design/Buff-Checklist-Research.md`.

Faerie Fire (Druid) and Curse of Recklessness (Warlock) are separate standard requirements with their own icons. Sunder Armor (Warrior) and Expose Armor (Rogue) remain alternatives in `armor-reduction` for planning, not a verified replacement rule. Forever armor-effect stacking is unverified: separate requirements indicate provider availability only, not simultaneous effects or additive armor reduction. Curse exclusivity also remains unresolved; one Warlock's provider results do not establish simultaneous curses. All four effects retain provisional confidence and scope, with no `verifiedOn`.

## Adding or correcting an entry

Each entry in `coverageEffects` has:

| Field | Meaning |
| --- | --- |
| `id`, `name` | Unique id and the label shown. |
| `kind` | The scope: `raid-buff`, `party-buff`, `targeted-buff` or `debuff`. **This is the party-versus-raid switch**: change it and nothing else when Forever changes who a buff reaches. |
| `providers` | Who can provide it: `className`, optional `specs` (roster specialization names; omit for any spec; Rogue is **Combat**), optional `talent`, optional `note`. Any one matching provider is enough. See "Specialization eligibility". |
| `stackGroup` | Give effects that do not stack, or replace each other, the same group. They count as one requirement with alternative providers. Buff scopes (`raid-buff`, `party-buff`, `targeted-buff`) may differ inside a group and the requirement then takes the most cautious one (targeted, then party, then raid); a debuff and a buff cannot share a group. Only group effects when evidence supports it. |
| `requirement` | Optional minimum number of **different** eligible players. Defaults to 1. Use more than 1 only when a verified mechanic requires it. In planning, a stack group uses the largest value among its displayed catalog effects. Not allowed on `party-buff` entries. |
| `representative` | Optional `true` on one effect of a group: its spell is the icon and the fallback tooltip spell for the requirement, and wins ties when choosing the displayed provider. Without it, the first effect with an icon is used. |
| `category`, `spellId` | Optional UI grouping text, and a spell id only where reliably sourced (positive whole number). The spell id also picks the icon (see below). |
| `visibility` | Optional. Omit (or `'standard'`) for the everyday checklist. `'encounter'` keeps researched data out of the checklist for possible future encounter-specific coverage. `'excluded'` hides one effect from the checklist, counts and panel (and from the engine) while keeping its data. Every effect in one `stackGroup` must use the same value, except that `'excluded'` may share a group with standard effects: only that effect leaves, the remaining alternatives stay. `'inactive'` behaves like `'excluded'` but marks an ability suspected to be Season of Discovery only (see below). An `'encounter'` effect cannot share a group with other values. |
| `confidence` | `confirmed`, `provisional` or `unverified`. |
| `scopeStatus` | `confirmed`, `provisional` or `unknown`: whether who the effect reaches (raid, party, one target, enemy) has been verified for WoW Forever. |
| `sources` | At least one: a link, a patch note, a tooltip or a name. Prefer current WoW Forever material over Classic. |
| `notes`, `verifiedOn` | Optional notes (build or version, caveats). `verifiedOn` is the date (`YYYY-MM-DD`) someone actually checked the game; never invent one. **Confirmed entries require it.** |

Rules of thumb:

- Only `confidence: 'confirmed'` **and** `scopeStatus: 'confirmed'` give a **verified** result. Confirmed means evidence specific to WoW Forever for the providers and the scope. A Classic reference alone is at best `provisional`.
- Source confidence is internal research metadata. The verified pass counts only confirmed data and the estimated pass also counts provisional data with a known scope. The separate planning pass accepts the catalog without confidence gating; UI status, counts and provider lists all use this planning result. Neither pass rewrites catalog metadata.
- Never expose research-confidence labels, source caveats or raw research notes in the coverage UI. Plain status labels, accessible names, help content and solid status borders describe roster availability and operational limitations only. Combined counts include each requirement once per status.
- Unsure about something from memory or Classic? Use `confidence: 'unverified'` and `scopeStatus: 'unknown'`.
- Multiple providers of one effect are alternatives for one requirement; a player is counted once however many alternatives they match.
- A `party-buff` always shows **Party Unknown**, because the app does not know who is in which party of five.
- A provider with a `talent` shows **Potential**, because talents are not tracked. Possible talent providers and party-only effects never satisfy a requirement as **Available**; explicit specialization assumptions remain supported.
- A targeted buff lists eligible providers and how many there are; it never claims everyone is covered.
- With no entries the panel says "No coverage data yet". With entries it shows planning coverage, independently of source confidence.
- Never put real character names in this file.

## Specialization eligibility

The roster already stores each player's class and specialization, and the engine reads them as they are (no extra fields). For each player and provider rule the result is one of:

| Eligibility | Meaning | Effect on coverage |
|---|---|---|
| Guaranteed | The class (and listed `specs`, if any) can provide it with no talent or rune choice. | Can make a requirement Available. |
| Assumed | A talent provider whose spec is explicitly named in the catalog assumption. | Available in planning and the internal estimate; Possible in the verified research result. |
| Possible | A `talent` or rune is needed, or the player's specialization is blank or not a recognised roster value for the class. | Potential only. |
| Ineligible | A different class, or a recognised specialization that is not in `specs`. | Not counted. |

- `specs` lists which roster specializations can provide the effect. It does **not** make a `talent` provider guaranteed or assumed: picking a spec does not prove the talent or rune was taken.
- `assumed: { specs, basis }` on a provider is the only way to assume a talent. It is per provider and per spec, never inferred from `specs`, and never applied to other talents of that spec. `specs` must be a subset of the provider's `specs`, the provider must have a `talent`, and the internal `basis` must cite the research. `validateEffects` enforces this.
- An assumed provider counts in planning and the internal estimate, never in verified coverage. It takes part in planning slot conflicts and may be Contested; possible providers never do. Help explains that the catalog assumes the talent for that specialization and individual talent selections are not tracked.
- Enabled assumptions: Feral Druid for Leader of the Pack and Balance Druid for Moonkin Form (the research records both talent trees). **Not assumed:** Guardian Druid for Leader of the Pack (no evidence), Marksmanship Hunter for Trueshot Aura (the research only infers the tree), Mana Tide Totem (unverified), and any rune.
- A provider with `specs` and no `talent` is guaranteed for those specs. Use that only when Forever evidence shows the ability is intrinsic to the spec. **No catalog entry does today.**
- A provider without `specs` is class-wide. Use that for baseline abilities: Wowhead's skill line (for example Blessing of Kings under Protection) is a category, not a spec requirement.
- Blank, misspelled or wrong-class specializations are never trusted to make something Available or to rule a player out; they are Possible. A class that is not in the roster table cannot be checked, so any non-blank spec counts as readable there.
- `validateEffects` rejects an empty `specs` list and a spec that is not a roster specialization for that class.
- Research confidence remains internal; it does not change planning labels or styling.
- Help popovers list eligible providers, then Guaranteed, Assumed, Possible and Not eligible providers in the team, with specialization names. Assumed providers explain the specialization assumption and untracked talent selection; the research basis stays internal.

Current `specs` (all talent-tree effects, so none is guaranteed): Trueshot Aura (Marksmanship, tree inferred), Leader of the Pack (Feral and Guardian, Feral Combat tree; the roster's Guardian mapping is unchecked), Moonkin Form (Balance) and Mana Tide Totem (Restoration, tree inferred, unverified).

**Needs a future talent and rune tracking feature before it can ever be verified Available:** Trueshot Aura, Leader of the Pack, Moonkin Form, Mana Tide Totem, and Dark Inspiration. Until then they are Potential, except Leader of the Pack (Feral) and Moonkin Form (Balance), which show Available through the explicit catalog assumptions above.

**Open audit questions (not assumed, so left class-wide):** whether Forever gates some effects recorded as baseline behind a talent, rune or form (for example Divine Spirit and Prayer of Spirit, Blessing of Kings, Demoralizing Roar needing Bear form). Confirm each in game, then add `talent` and `specs`.

## Updating after a balance change (no code needed)

All game facts are data. Edit the file in the table, keep the entry's other fields as they are, and never copy a number from Classic or from unconfirmed patch notes. If the new fact is not yet checked in game, set `confidence: 'provisional'` (or `'unverified'`, with `scopeStatus: 'unknown'`) rather than `'confirmed'`.

| What changed | File | Field to edit |
| --- | --- | --- |
| A spell's description or highest rank | `spellDescriptions.ts` | `description`, `rank`, `tooltipSpellId` (the highest-numbered rank's spell ID), `sourceUrl` (its Forever page). Copy the text from the Forever tooltip; do not paraphrase it. Remove `reason` once a description is present. |
| A spell ID, or a rank's ID | `coverageData.ts` | `spellId` (the ID shown for the spell). Then update `spellDescriptions.ts` and `spellIcons.ts`, which are keyed by the same ID. |
| The icon | `spellIcons.ts` | The icon name for that `spellId`. To choose which spell of a group supplies the icon, set `representative: true` on that effect in `coverageData.ts`. |
| Party-wide became raid-wide (or back), for example Windfury Totem | `coverageData.ts` | `kind`: `'party-buff'` or `'raid-buff'`. Nothing else changes; the calculation reads it. Update the `notes` and `sources`. |
| Which classes or specializations can provide it | `coverageData.ts` | `providers`: `className`, `specs` (roster specialization names, Rogue is **Combat**). |
| A talent or rune is needed | `coverageData.ts` | `providers[].talent`. An `assumed` entry is a planning assumption and needs a `basis`; add one only with research behind it. |
| Two effects overlap (do not stack) | `coverageData.ts` | Give them the same `stackGroup`. |
| One player can fill only one of several effects | `coverageData.ts` | The same `slot` (only with a Forever source). |
| Show or hide it in the standard checklist | `coverageData.ts` | `visibility`: omit for standard, `'encounter'` or `'excluded'` or `'inactive'` to keep the research but hide it. |
| A consumable alternative | `consumableData.ts` | See below. |
| Source and verification | `coverageData.ts` | `sources` (links), `confidence`, `scopeStatus`, `verifiedOn` (`YYYY-MM-DD`, only a real in-game check). |

After any edit, run the checks (next section). The data tests fail with a plain-language message if a field is missing, a date is malformed, a slot is wrong or a spell has no stored description or icon. If a test about the number of effects or requirements fails after you add or hide an effect, that test needs its expected count updated in the same change.

The standard checklist excludes these on purpose, and they must stay out of the visible results: resistance buffs, Heart of the Lion, Valor of Azeroth, Tremor Totem, Stoneskin Totem, Windwall Totem, Devotion Aura, Fear Ward and all Paladin Judgements and Seals. They keep their research in the catalog with `visibility: 'excluded'` (or `'encounter'` for the resistance data).

## Season of Discovery abilities

WoW Forever's Wowhead database is built from Season of Discovery era data, so SoD-only spells and rune engravings appear on Forever pages. A Forever page is therefore **not** evidence that an ability exists in Forever. Entries with no Forever-specific evidence are set to `visibility: 'inactive'` with `confidence: 'unverified'`: kept as research, never shown, counted or given provider credit. Currently inactive: Horn of Lordaeron, Wild Strikes, Homunculi and Vampiric Touch (SoD-range spell IDs, level 1 rune-style spells or `Engrave` rune engravings, and no Forever-range rank). Heart of the Lion and Valor of Azeroth stay `'excluded'` by owner decision. Do not make an inactive entry standard without a Forever-specific source (a Forever build article, patch note or in-game check). The tests fail if a standard effect has a spell ID in the SoD range (400000 to 999999) that is not on the explicit allowlist (Curse of the Elements, whose later ranks are Forever-range IDs), or a provider whose talent starts with `Rune`.

## Consumable alternatives

[`consumableData.ts`](./consumableData.ts) lists consumables that can stand in, usually more weakly, for a class buff. It is **empty today**: no consumable (including Drums of Kings) has been verified from a WoW Forever source, so none is assumed. Add one only with a Forever source and the effect text copied from it:

- `requirementKey`: the `stackGroup` (or the `id` of an ungrouped effect) it stands in for.
- `effect`: what it does, as the source says. `limitation`: how it is weaker or different. Both are shown to the organizer.
- `spellId` (icon looked up in `spellIcons.ts`) or `iconName`, `confidence`, `sources`, `verifiedOn`.
- An `unverified` entry stays as research and cannot be planned.

An organizer ticks a consumable under the open coverage strip to mark it **planned**. Plans are stored in this browser only (localStorage, per team) and are never written to Firestore or shared with the guild. A planned consumable turns a requirement's icon muted gold only when class coverage does not already satisfy it; the status, counts and tooltip still show the class result (for example Missing), and nothing is ever marked supplied just because it exists in the catalog.
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

- **Team card header:** a collapsed-by-default "Buff & debuff coverage" section with one count per planning status. Expanded, it shows one spell icon per requirement. Available is full colour; Missing is dimmed and tinted red; unresolved statuses are muted; a planned consumable is muted gold. All icons use solid status borders. Accessible names include the spell name and actual status. Tap/click, Enter or Space opens the shared HelpPopover with the stored spell description, roster coverage meaning, eligible providers, specialization/talent requirements and relevant operational limitations or conflicts. Escape returns focus; outside interaction, focus leaving, page/nested scrolling and viewport changes dismiss it. Nothing is fetched on activation.
- **Panel below the teams:** grouped planning statuses, assigned providers, effect scope and eligible class/spec/talent requirements. Research notes, source confidence and verification dates stay in the catalog and research document, not the rendered panel.
- Both use the same engine and show only `standard` effects. Encounter-specific effects (currently the Fire, Frost, Nature and Shadow resistance auras and totems, Aspect of the Wild and Priest Shadow Protection) stay in `coverageData.ts` and the research document but are not calculated or shown.
- **Descriptions:** [`spellDescriptions.ts`](./spellDescriptions.ts) holds, for each catalog `spellId`, the spell's highest Forever rank: `tooltipSpellId`, `rank`, `sourceUrl` (its Wowhead Forever page), the name and the description, read on 2026-10-16 so hovering makes no request. The highest rank is the highest rank number listed on the Forever spell page (not the highest spell ID); a spell with no ranks uses its own id and has no `rank`. The text is the Forever tooltip for that rank; where the tooltip carried unresolved formulas (Windfury Totem, Flametongue Totem) the text comes from Wowhead's per-rank Forever change list and is marked `descriptionSource: 'change-list'`. No Classic, TBC or Retail text is used. Three entries (Horn of Lordaeron, Vampiric Touch, Valor of Azeroth) have no description because their data contains unresolved formulas; they show "Highest-rank spell description unavailable" and carry a `reason`, and need review. Add an entry here when you add a `spellId`. The icon stays the catalog spell's icon; the highest ranks use the same icons.
- **Icons:** [`spellIcons.ts`](./spellIcons.ts) maps spell ids to Wowhead icon names (from `nether.wowhead.com/forever/tooltip/spell/<id>`) and builds the `wow.zamimg.com` image URL. Add a line there when you add a `spellId`. A spell with no icon, or an image that fails to load, shows its initials instead. Icons are display only and never affect coverage.

## What Available means

Available means an eligible provider exists in the assigned roster, not that every raid member has received the buff. For a targeted buff (Blessing of Might or Kings, Power Word: Fortitude, Mark of the Wild and similar) one provider is enough for Available however many players are assigned; who gets the buff, and how many casts are needed, are not modelled. Party-wide effects (currently Mana Spring Totem and Mana Tide Totem, whose Forever text says group members) affect only five players, and five-player parties are not tracked, so on their own they show Party Unknown at every team size (10, 20 or 40 players), never Available. Effects whose Forever text says party or raid (Windfury, Flametongue, Strength of Earth, Grace of Air, Trueshot Aura and others) are raid-wide. Scope is judged per provider, so a raid-wide or targeted alternative can still make a requirement Available while a party-wide alternative alone shows Party Unknown. Change a spell's scope with its `kind` field only when the stored Forever text supports it.

## Status labels

Available, Contested, Missing, Potential (talent, rune or specialization unresolved), Party Unknown (party groups are not tracked) and Not calculated (calculation limit). The internal research-only `unverified` status is never a planning warning.

## Slots: effects that compete for the same player

Some effects cannot be maintained together by one character (for example a rule such as "one aura per Paladin"). Give such effects the same optional `slot` (lowercase words joined by hyphens, such as `paladin-aura`). One player can then fill at most one requirement per slot.

- Only add a `slot` when a WoW Forever source supports it. Do not copy Classic rules. The Shaman totem slots, Horn of Lordaeron and Mass Salvation are **unresolved** and must not get a slot until verified.
- Slots apply only to `raid-buff` and `debuff` entries. Party and targeted buffs are never matched, and a slot on them is reported by `validateEffects`.
- All effects in one `stackGroup` must use the same slot. A group may mix slotted and unslotted effects: a player who provides it through an unslotted effect needs no slot.
- Slots are checked in all three passes using the same algorithm. Planning accepts every catalog effect; guaranteed and explicitly assumed providers compete, possible talent providers do not. Party and targeted effects remain outside slot matching.
- **Missing**: fewer eligible players than the requirement needs, even on its own.
- **Contested**: it can be met on its own, but it belongs to a minimal set of requirements that cannot all be met at once. The panel names one such set, not every one.
- **Available**: it can be met on its own and belongs to no such set. This means no modelled conflict, not that the effect is active in game.
- **Not calculated**: a valid catalog whose exact check stopped at its limit (20,000 search steps per requirement, or more than 30 competing requirements in one group). The result is unknown, never guessed. Potential is unaffected, because it is decided before any slot search.
- **Catalog error**: an invalid slot setup (a badly named slot, a slot on a party or targeted buff, or two different slots in one `stackGroup`) is a data-file mistake, not a limit. `validateEffects` reports it, and the panel and strip show an error instead of any coverage. It is never shown as Not calculated.
- Planning checks Party Unknown, Missing/Potential, then Available, Contested or Not calculated from slot matching. Guaranteed and explicitly assumed providers reach slot matching; research confidence does not gate them.
- The result does not depend on the order of players or catalog entries. Identical requirements are not merged yet.
