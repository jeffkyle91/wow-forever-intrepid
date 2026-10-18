# Raid Buff & Debuff Coverage Checklist — Proposed Design

**Project:** WoW Forever Intrepid  
**Issue:** #16 — Raid coverage checklist (buffs and debuffs), first version  
**Status:** Draft for maintainer review; not an authoritative game-mechanics reference  
**Last updated:** 2026-10-16

## 1. Purpose and boundaries

Provide a **read-only**, **collapsed-by-default** coverage checklist within the existing Raid Teams screen. Help raid leaders see which useful effects can be supplied by the players assigned to a raid, which effects have no eligible assigned provider, and which conclusions are uncertain. All application roles may view it.

The first version analyzes **assigned raid-team members**, not raid signups or unassigned roster members. It does not confirm that a spell was cast, that a talent was selected, or that a particular player received a targeted/party effect. It must not change Firestore documents, security rules, authentication, role permissions, or deployment settings.

This document specifies behavior and a fact-review process. It intentionally does **not** certify a WoW Forever spell list. The team must supply or verify game facts before marking any effect confirmed.

## 2. Existing application data and raid grouping

The roster exposes player ID, class, specialization and role, but does not expose selected talents or five-player party/subgroup assignments. Team assignments map a player ID to one of four ten-player teams: **Blue**, **Yellow**, **Red**, **White**.

| View | Independent raid compositions evaluated |
| --- | --- |
| 10-player | Blue, Yellow, Red, White — each evaluated separately |
| 20-player | Green = Blue + Yellow; Pink = Red + White |
| 40-player | Brown = Blue + Yellow + Red + White |

The UI has one coverage panel with a selector for the compositions available in the current view. Reuse the existing team definitions in `src/shared/game/teams.ts`; do not duplicate the grouping rules. Select members using actual assignments and deduplicate by player ID. The current raid view does not make every visible team one shared raid: 10-player teams and the two 20-player groups are separate compositions.

## 3. Effect scopes and interpretation

| Scope | Calculation | User-facing interpretation |
| --- | --- | --- |
| Raid-wide | Search all assigned players in the selected raid composition | An eligible provider is **Available**, not proof the effect is active |
| Party-wide | Identify potential providers but **do not infer five-player party membership** | **Party Unknown**; show providers, never claim full party coverage |
| Targeted | Show eligible provider presence/count; recipients and casts are unknown | Provider available/potential, not “all members covered” |
| Enemy debuff | Search the selected raid composition for providers of the effect applied to an enemy | An eligible provider is **Available**, not proof the debuff is applied |

An effect's **mechanical scope** (raid-wide, party-wide, targeted, enemy-debuff) is separate from its **scope verification status** (verified or not verified for WoW Forever). Both must be recorded. Do not infer scope from WoW Classic behavior.

## 4. Coverage states and precedence

| State | Meaning |
| --- | --- |
| **Available** | The game fact and scope are confirmed, and an assigned player matches a provider without any unobservable requirement. This is *availability*, not a live aura measurement. |
| **Missing** | For a confirmed, computable effect, no eligible assigned provider is found. An eligible provider whose required talent is unknown must not be treated as Missing. |
| **Potential** | A matching class/spec exists but an individual talent or other necessary condition cannot be verified from application data. |
| **Unverified** | The game fact or its scope has not been confirmed for WoW Forever; keep out of confirmed Available/Missing totals, even if a candidate provider exists. |
| **Party Unknown** | A confirmed party-wide effect cannot be evaluated for actual recipients because five-player party assignments are not tracked. Show candidate providers separately. |

**Recommended precedence:** Unverified facts first; then Party Unknown for confirmed party effects; then Potential when provider eligibility depends on unknown requirements; then Available/Missing for computable confirmed effects. Targeted effects must never be presented as proof of full-recipient coverage. Display clear labels as well as colors.

## 5. Catalog schema

Keep actual game facts in one editable file, `src/shared/raid-coverage/coverageData.ts`. Supporting TypeScript types and calculation code can be separate.

Each effect should capture:

- `id`: stable identifier; `name`: displayed effect/category name.
- `kind` / `scope`: raid buff, party buff, targeted buff, or enemy debuff; record scope consistently.
- `category`: optional UI grouping, e.g. offensive, defensive, healing/mana, resistance, enemy debuff.
- `providers[]`: alternative class/spec combinations; optional talent requirements and explanatory notes. A spec match does **not** establish a selected talent.
- `stackGroup`: optional identifier for mutually exclusive/non-stacking alternatives; define precisely what shares the group. Multiple providers of one effect do not imply multiple coverage requirements.
- `requirement`: optional minimum eligible providers **only if** a verified mechanic requires a number greater than one; do not assume or silently ignore it.
- `confidence`: `confirmed`, `provisional`, or `unverified`.
- `scopeStatus`: explicitly indicates whether the stated scope has been verified for WoW Forever. Use the exact type/value conventions adopted in the implementation.
- `sources[]`: links or precise references supporting the effect, providers, talent and scope. Prefer current WoW Forever materials over Classic analogies.
- `verifiedOn`: optional ISO date for an actual verification, never a fabricated date.
- `notes`: uncertainties, version/build, stacking caveats, and follow-up work.
- Optional `spellId`, where reliably sourced.

### Fact-review rules

A fact is **confirmed** only when the team has evidence specific to WoW Forever for the claimed behavior, including provider and scope. A Classic reference alone is **provisional** at best. Beta behavior may change between builds; record the relevant build/version when known. An effect with missing or contradictory evidence is **unverified**. Keep unverified candidates visible but separate from confirmed coverage counts.

**No production buff/debuff entries are approved by this document.** Populate the catalog from sourced WoW Forever evidence or a maintainer-approved catalog. Avoid fictional entries in production; invented classes/effects are fine in tests.

## 6. Stacking and alternative providers

- Treat multiple providers of the **same effect** as alternative ways to satisfy one requirement unless verified rules say otherwise.
- Group genuinely mutually exclusive or non-stacking **effects** using `stackGroup` only when supported by evidence; do not conflate similar names or assume the strongest rank wins without proof.
- If a group has both confirmed and unverified alternatives, distinguish unverified provider matches explicitly; never make a Missing row appear confirmed merely by listing an unmarked unverified provider.
- Do not implement numeric stacking, effect strength comparisons, uptime, or talent inference without sourced rules.
- If a future verified effect requires multiple providers, implement and test the minimum-provider requirement before using it in production data.

## 7. User interface

- Append the `RaidCoveragePanel` as a sibling **after** the existing `.raid-team-workbench` in `RaidTeamsView.tsx`; do not wrap or reorder existing workbench children.
- Use an accessible native `<details>`/`<summary>` or equivalent, initially collapsed, with a single composition selector: four 10-player teams, two 20-player groups, or one 40-player group.
- Present coverage counts only when game data exists and is verified enough to compute them. An empty catalog displays **“No coverage data yet”**, not misleading zero coverage.
- Show effect name, state, matching provider(s), scope, confidence and source details. Clearly label uncertain providers.
- Ensure keyboard use, light/dark theme contrast, and labels independent of color.
- Keep CSS local to the feature and prefix selectors `.cov-`.
- No edit buttons, permission gating, Firestore writes, new sidebar tab or route.

## 8. Implementation boundaries

Coverage code lives in `src/shared/raid-coverage/` for reuse by Teams and Leadership. Integration should change only the minimum necessary lines in the consuming feature. Coverage itself needs no Firestore, authentication, `App.tsx`, routing or shared-state changes.

**Architecture decision needed:** `AGENTS.md`/`ARCHITECTURE.md` prohibit importing one feature from another. Importing `RaidCoveragePanel` directly into `RaidTeamsView.tsx` is a cross-feature import, even if Issue #16 permits editing that file. The repository maintainer must approve a narrow exception or specify a compliant integration approach before merge. Do not silently treat the issue's allowed file list as an override.

## 9. Tests and verification

Automated tests should cover empty data, empty teams, assigned-only selection, 10/20/40 grouping, duplicate players, alternative providers, stack-group deduplication, talent-dependent Potential, confirmed party-wide Unknown, targeted provider-only presentation, provisional/unverified precedence, and data validation. Include actual project specialization strings (e.g., Combat) where appropriate. Use fictional names in fixtures.

Run the project's build and lint plus the dedicated Node test suite and its TypeScript type-check. Verify the interface manually at all three raid sizes in light and dark modes, including expand/collapse, selector behavior and no browser console errors. Do not assume the new tests are included in existing CI unless explicitly wired into it.

## 10. Updating or correcting a game fact

1. Identify the effect and gather evidence specific to the current WoW Forever build.
2. Edit its entry in `coverageData.ts`: provider class/spec/talent, scope, stacking group and any other supported fields.
3. Add a source reference, confidence, scope-verification status and explanatory notes. Set `verifiedOn` only when verification actually occurred.
4. Add or adjust unit tests for any calculation rule that changed; validate the data.
5. Run build, lint, coverage tests and test type-check; review the rendered panel.
6. Submit a feature-branch commit and PR for review. Do not silently replace a verified claim with a Classic assumption.

## 11. Acceptance criteria and remaining decisions

- [ ] Read-only panel appears on Raid Teams for all roles and is collapsed by default.
- [ ] 10/20/40 raid selection matches existing team assignments.
- [ ] Only assigned players count; five-player party coverage is never invented.
- [ ] Targeted and talent-dependent effects do not overstate certainty.
- [ ] Unverified effects stay out of confirmed coverage totals.
- [ ] Alternative/non-stacking effects do not inflate requirement counts.
- [ ] Every production game fact has traceable evidence, confidence and scope status.
- [ ] Empty data has a useful, honest empty state.
- [ ] Automated tests, build, lint and manual UI checks pass.
- [ ] Maintainer approves the cross-feature integration exception or an alternative.
- [ ] Maintainer approves the initial sourced buff/debuff catalog before calling the checklist game-data complete.

**Out of scope for Issue #16:** tracking five-player party assignments, storing selected talents, raid signup coverage, live combat/aura verification, encounter-specific optimization, and Firestore schema changes. These can be separate follow-up issues.
