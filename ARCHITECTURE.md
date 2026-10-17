# Architecture

How the code is organized, and how to add to it without stepping on each other. Read this before adding a feature.

## Layout

```text
addon/                         In-game Lua addon work, not part of the web build (see docs/design/loot-addon.md)
data/loot/                     Loot table captures: item ids per creature, one file per dungeon or raid (see data/loot/README.md; npm run check:loot)
tests/
  rules/                       Firestore rules tests, run on the emulator (npm run test:rules)
  unit/                        Tests of pure functions, run by Node directly (npm run test:unit)
src/
  main.tsx, index.css          entry point and design tokens
  App.tsx                      composition root: shared state, hooks, and the layout of the shell
  App.css                      shared layout and primitive styles (global)
  firebase.ts guildApi.ts      core: Firebase client, record types and write helpers
  useGuildData.ts              core: live subscriptions to the guild collections
  useGuildSession.ts           core: sign-in and membership
  security.ts                  core: UI-side role predicates (UI only; Firestore rules decide)
  AccessScreen.tsx             sign-in and access-request screen (not a tab)
  authErrors.ts                core: friendly text for Firebase Auth error codes (used by AccessScreen)
  shell/                       the frame around every tab
    tabs.ts                    the tab registry
    Sidebar, Topbar, PageHeading, StatStrip, WorkspacePanel, ModalHost
  features/                    one folder per feature
    roster/ teams/ calendar/ loot/ access/
  shared/                      things two or more features use
    tabs/types.ts              the contracts: TabDefinition, TabContext, ModalRenderer
    ui/                        Modal, ArtIcon, EmptyRow, RolePill, ClassAvatar, ErrorBoundary
    game/                      class/spec data and the raid team definitions
    lib/dates.ts, art.ts, normalize.ts
```

Dependencies point one way: `shared` and the core files at the top of `src/` import nothing from `features` or `shell`; a feature imports `shared` and the core files, never another feature and never `shell`; `shell` imports a feature only through its `tab.tsx`; `App.tsx` imports `shell`. If two features need the same thing, move it to `shared` in its own small change.

## How a tab works

Every tab is one `TabDefinition` (`shared/tabs/types.ts`) exported from its feature's `tab.tsx` (the loot feature exports two, `prioritiesTab` and `historyTab`) and listed in `shell/tabs.ts`. The shell reads that definition to draw the sidebar entry, page title and hint, the search box, the toolbar, the content, the record count and the footer. A feature never edits `App.tsx` to appear.

The shell passes each tab one `TabContext`:

| Field | What it is |
| --- | --- |
| `data` | the live guild data (`roster`, `assignments`, `priorities`, `awards`, `afkEntries`, `raids`, `raidZones`, `settings`, `members`, `joinRequests`, `characterRequests`), request loading/error state, and `unreadable`, how many documents were skipped because they could not be read |
| `query` | the current search text |
| `identity` | `uid`, `displayName`, `canEditRoster`, `canEditRaidData` |
| `shell` | `raidView` and `setRaidView` (the 10/20/40 selector lives in the shell so it survives tab switches) |
| `feedback` | `busy`, `setBusy`, `setMutationError`, `setNotice` (one shared banner and busy flag) |
| `openModal(render)` | opens a dialog (see below) |
| `navigate(id)` | switches tab; ids are matched as strings, an unknown id is ignored (and logged in development); does not clear the search text |

A new `TabContext` object is built on every render, so do not put `ctx` or `ctx.openModal` in a hook dependency array.

`TabContext` deliberately carries no role string. Role display and the "VIEW AS" preview live in `App.tsx` and `shell/Topbar.tsx` only. The `identity` booleans decide which controls to show; Firestore rules decide what direct client access is allowed. Availability and raid-response writes are server-only: their authenticated callables check the real account's membership and ownership. Never put an authorization decision in the UI alone, and never pass a previewed role to a data hook or a write helper.

## Adding a tab

1. Create `src/features/<name>/` with a content component, `<Name>Tab.tsx`, taking `{ ctx }: { ctx: TabContext }`.
2. Add `src/features/<name>/tab.tsx` exporting `<name>Tab = { id, label, art, hint, panelTitle, recordCount, footer, Content, ... } as const satisfies TabDefinition`. Write it exactly that way, without a `: TabDefinition` annotation, so the `id` stays a literal; the registry fails to compile if an id widens to `string`. Optional fields: `search`, `navCount`, `guildLeaderOnly`, `HeadingActions` (buttons beside the page title), `Toolbar` (controls beside the search box). Naming: the definition is `rosterTab`, the content component it points at is `RosterTab`.
3. Add one import and one line to the `tabs` array in `src/shell/tabs.ts` (one entry per line, so two people adding tabs rarely conflict). The order of that array is the sidebar order.
4. Import any new artwork from the feature itself (`import art from '../../../Art/...'`). `shared/art.ts` is the list of art the existing shell and features use; avoid editing it so two people don't both append to it.
5. Add a stylesheet for the feature if it needs one (see CSS below).

## Dialogs

Open a dialog with `ctx.openModal(({ close, live }) => <MyModal ... close={close} live={live} />)`. One dialog is open at a time; `shell/ModalHost.tsx` renders it after the main content and remounts it on every open.

- Capture the thing being edited (an award's priority, a player) in the closure when you open the dialog, and compute anything that must not change while it is open (such as a default date) in the click handler before calling `openModal`, not inside the renderer.
- Read everything that changes (`busy`, identity, data) from `live`, never from the `ctx` you opened it with, or the double-submit guards go stale.
- The renderer is a single JSX return of your modal component and contains no hooks. Put hooks inside the modal component.

## Data and rules

`useGuildData` subscribes to the guild's collections once and every tab reads them from `ctx.data`. Writes go through `guildApi.ts`. `navCount`, `recordCount` and `footer` are functions of `ctx.data`, so today a tab can only show counts for data the shell already loads. If a feature needs its own collection, agree on how it loads that data (a hook inside its content component, or a new shared subscription) before building it. Adding a new collection currently touches shared files: the record type and write helper in `guildApi.ts`, a subscription in `useGuildData.ts`, and a block in `firestore.rules` (Firebase deploys a single rules file) with its tests in `tests/rules/` (see "Testing the Firestore rules" in `CONTRIBUTING.md`). Do each in its own small commit and say so in the PR so a reviewer looks at the rules change on its own. Rules are the authorization boundary, so a feature that writes data needs a rules change and a rules deploy before the hosting build ships.

Roster comment review uses `useRosterComments` through `useGuildData`: Public comments are subscribed for authenticated members; Leadership collection subscriptions use only the actual Guild/Raid Leader role, never VIEW AS. A session-only Show Comments toggle beside All characters/Hide alts replaces the normal columns with Character, Public and (for leaders) Leadership comments. Comments use small-text previews and tap/click/keyboard-triggered native popovers, which float above the table without changing row height. Comments appear on the character with the linked account; unlinked alts do not inherit another account's comments. Loading, empty and failed reads are distinct, and unreadable records are reported. The Leadership column is hidden in a Member preview without changing the real-role subscription. Authors continue editing both audiences on the dashboard; existing Firestore rules allow authors to read their own Leadership comment but deny other members' private comments and collection lists.

Award snapshots are immutable: the candidate order and council note are copied from the priority as it was when the award dialog opened (`features/loot/AwardModal.tsx`) and the rules compare them to the stored priority. Do not change that flow casually. A manual award (no `priorityId`, for a decision made without a priority list, such as a roll) has no snapshot at all: it is recorded with a roster character's id and a `decision`, and the rules accept it only together with its audit entry (see [audit-first-loot.md](docs/design/audit-first-loot.md#manual-awards-loot-002)).

Raid sign-ups live at `guilds/<guildId>/raids/<raidId>/signups/<uid>`. `raidSignups.ts` owns the per-raid subscription and calls the server to save responses; `shared/raids/RaidSignupModal.tsx` is shared by the calendar and dashboard, without adding a global subscription. Each response stores a character id, status, server update timestamp, and `benchKind: 'self'` only for Bench. Response buttons save immediately, with response-specific colors on hover/selection. A separate team preview is available only for a saved Accept, Tentative or Late response; `shared/raids/roster.ts` selects only that saved character's live 10-player team, with no main-character fallback or zone-size expansion. No starting roster is saved yet.

Each upcoming dashboard raid subscribes while mounted so its compact, centered action shows the current account's response above "Click to change or view details", or "Sign-up / roster" before a response. Unavailable dates display Absent immediately while server synchronization catches up. The action sits beneath the raid details and unavailable/cancelled badge visually, without reordering the existing row markup.

`functions/index.js` exposes authenticated callables implemented in `functions/raids.js`. Firestore rules deny all direct writes to `afkEntries`, sign-ups and server-only `availabilityLocks`; other collections retain their existing authorization rules. The server rechecks guild membership, reciprocal main/direct-alt ownership, cancellation and the start cutoff, and queries actual unavailable ranges. It never trusts caller-supplied uid, display name, team, timestamps or bench provenance. Availability changes and response saves share a transaction lock at `guilds/<guildId>/availabilityLocks/<uid>`, preventing stale concurrent writes. Adding an event atomically saves Absent on overlapping upcoming raids; deleting an event leaves Absent, even for legacy events not yet backfilled. Unlinked accounts can record unavailable dates without fabricating a character response.

Firestore triggers synchronize newly scheduled/rescheduled/restored raids and newly linked mains. They re-read current state in transactions, so delayed/retried events cannot resurrect an old response. `shared/raids/availability.ts` derives effective Absent for every roster preview while triggers catch up. All overlapping events must be removed before manual responses are allowed; removing them does not restore the previous response. Started/cancelled raids are not rewritten by automatic synchronization. A Guild Leader-only Settings action runs the idempotent initial backfill. See README for Functions setup and deploy order; these server handlers are tested against the local Firestore emulator in `functions/raids.test.js`.

New raids store `startsAt` as a Firestore timestamp derived from their Eastern date/time in `shared/lib/raidStart.ts`. Saving an older raid initializes it; rescheduling updates it in the same audited change. Nonexistent spring-forward times are rejected, and the repeated fall hour uses its first occurrence. Existing raids without `startsAt` remain readable/editable, but the response callable refuses manual sign-ups until a leader saves their details. This cutoff does not freeze team assignments; the dialog explicitly labels them as a live preview until server-side locking is built.

### Item tooltips

Item names, icons and tooltips are read live from Wowhead's public tooltip endpoint by item id (`shared/game/itemTooltip.ts` has the addresses; `shared/lib/itemInfo.ts` keeps an in-memory cache, runs four requests at a time and retries once; `shared/ui/ItemTooltip.tsx` shows an item as a chip that opens its tooltip when a mouse rests on it and on click, tap or Enter; hover is a mouse-only convenience, since touch and keyboard have no hover). The tooltip HTML comes from a third party, so it is never put into the page: `sanitizeTooltipHtml` reads it into a tree of allowed elements and allowed class names (no links, images, styles or scripts), and the component renders that tree as ordinary React elements with prefixed class names. Use `ItemTooltip` wherever an item id should show a tooltip; a failed lookup leaves the id (or a typed name) in place, so manual entry never depends on Wowhead. Capture files in `data/loot/` hold ids only (see `data/loot/README.md`).

### Priorities from the drop lists

A leader can tick items in Browse drops (`features/loot/DropsBrowser.tsx`) and add them to Loot priorities. Each becomes a priority with a fresh id (one per item per phase is kept by the dialog, which marks an item already on the list; see the audit section for why ids are not reused), the item's Wowhead name as `item`, `encounter` in the same "dungeon · boss" form as one typed by hand, an empty `rankedPlayers` ("Needs players"), and the optional `itemId`, `zoneId` and `npcId` that say where it drops (`PriorityRecord` in `guildApi.ts`; the normalizer drops any that is not a positive whole number). A priority with an `itemId` shows its real name, icon and tooltip through `ItemTooltip`; one typed by hand looks as before. An item counts as already listed when a priority has its id or, for a hand-typed one, the same name (`prioritiesForItem` in `dropsFilter.ts`). In the dialog a ticked box means "on the list": ticking an unlisted item stages an add, unticking a listed one stages a removal (`deleteLootPriority` in `guildApi.ts`, which removes every priority that stands for the item), and nothing is written until the bar at the bottom is used. Add all and Remove all stage a whole dungeon. A removal that would drop assigned players asks once more. Awards keep their own copy of the candidate order, so removing a priority does not touch history. The rules do not field-check priorities yet, so this needs no rules change, but the stage 3 tightening must allow the three fields (see [audit-first-loot.md](docs/design/audit-first-loot.md)). The member dashboard still reads `item` and `rankedPlayers` only.

### Phases of the loot lists

A phase is a number (`shared/game/phases.ts`), not a name, so renaming one in Settings cannot split its lists. Settings gets one optional field, `phaseHistory`: the names of the finished phases, oldest first. The current phase's number is its length (a guild that never closed a phase is in phase 0), and `currentPhase`/`nextPhase` stay the names of the current and next phase. A priority and an award carry `phaseNo`; none means phase 0, so everything recorded before phases existed is the first phase and nothing is migrated. A priority can also carry `carriedFrom`, the id of the priority it was carried over from.

`useGuildData` keeps `priorities` as the **current phase's** list, so the dashboard, the counters and anything written before phases need no change, and adds `allPriorities` for the Loot priorities tab, which looks at one phase at a time (`features/loot/usePhaseView.ts`; the choice is `phase` in `priorityFilters.ts`, null meaning "the current phase"). Starting a phase (the Loot phases section in Settings, Guild Leaders only, with a typed confirmation, `features/settings/PhasesPanel.tsx`) is one save of the settings document that appends the closing name to `phaseHistory`, and reopening takes it off again; no priority or award is rewritten, because the lists prepared for the next phase are already filed under the number that becomes current. The rules accept only those two moves (`validPhaseHistory`). A closed phase is read-only in the app; nothing in the rules stops a write to it yet. The target, with LOOT-001, is a priority rule that allows a write only when its `phaseNo` is the current phase's, read from Settings in the same rule. Until then an old browser tab that predates this feature writes priorities without `phaseNo` (phase 0). The same item can be on each phase's list. An award with no priority counts toward a priority of the same item name only in the same phase.

### Carrying an item over

The Carry over dialog (`features/loot/CarryOverModal.tsx`) creates a new priority in the phase being looked at from one in an earlier phase: `carryOverFields` (`carryOver.ts`) copies the item, boss, note and the whole candidate list and sets `phaseNo` and `carriedFrom`; it is written with `createPriorities`, so it is in the Log. Nothing about "received" is copied. `awardsForPriority` (`completion.ts`) follows `carriedFrom` back through the priorities it names (at most 20 steps, never twice the same one) and counts the awards recorded from any of them, and unlinked awards of the same item name in any of their phases, so a carried priority shows who already got it and who still needs it, while the earlier phase's record never changes. The lookup is built from `ctx.data.allPriorities` (`usePhaseView`).

### The audit of loot changes

Every change to a loot priority or an award is one batch of the change and its audit entry (`auditLog/{type}_{id}_{rev}`; `award_{id}_1` for a new award). The helpers are in `guildApi.ts` (`createPriorities`, `editPriority`, `deletePriorities`, `recordAward`) and nothing else writes these collections: `saveGuildRecord` is for the roster only, and the rules refuse a priority or award write without a truthful entry (`validPriorityCreate`, `validPriorityEdit`, `validPriorityDelete`, `validPriorityAward`, `validManualAward`; the entry rules are `validAuditEntry` and `auditDescribesChange`). What an entry lists is built by the pure functions in `shared/game/lootAudit.ts` (`describeCreate`, `describeEdit`, `describeDelete`), which have to agree with those rules: the fields that differ, each with its old and new value. A priority also carries `rev`, `updatedBy` and `updatedAt`, stamped by the rules, and can be written only in the current phase or the next one. A long list is written in batches of `AUDITED_BATCH_SIZE` (10) because a batch has a limit on the document lookups the rules may make (the numbers are pinned in `tests/rules/batch-budget.test.ts`); each batch is all or nothing and the helpers report which ids a batch wrote. An entry id can be used only once, so every new priority gets a fresh id (`newPriorityId`): the id of a deleted priority cannot be created again.

The Log dialog (`features/loot/AuditLogModal.tsx`; it replaced the Award history tab, so there is no separate list of awards) listens to the newest 100 entries only while it is open (`subscribeAuditLog`), with "Load older entries", and `features/loot/auditText.ts` turns an entry into words. It filters out raid entries, adds the awards recorded before the Log began (they have no entry and no revision; `legacyAwardEntry` shows each as an entry dated the raid night) and has a find box over what is loaded. Starting or reopening a loot phase is logged too (`changePhase` in `guildApi.ts`): the settings document carries `phaseRev`, how many times a phase has been started or reopened, and the entry `phase_settings_{phaseRev}` lists the phase fields (`currentPhase`, `nextPhase`, `phaseHistory`) that differ between what is stored and what is saved; the rules accept a change of the phase history only with the next revision and its entry (`validPhaseRev`, `validPhaseEntry`). The entry a write needs has to be one written in that very request (`writtenNow`), so an entry left from an earlier life of an id cannot stand in for a new one. The log can be read by every guild role and changed by nobody through the app; the owner of the Firebase project can still change anything in the console, which the rules cannot prevent.

### Reading data safely

Character changes use `characterRequests` and the authenticated callables in `functions/characters.js`. Direct client writes to requests are denied, including for leaders; only the owner and Guild Leaders can read them. `useGuildData` subscribes to all requests for the actual Guild Leader role, or a `userId == actualUid` query for other active accounts, never using VIEW AS. It exposes separate loading/error state and clears records when the session/actual identity changes. `shared/characters/` owns submission, history and reusable review controls used by My dashboard and Member access; MEMBER-003 can reuse them without importing another feature. Requests retain immutable submission snapshots, server timestamps, actor identity and terminal decisions/notes. Members withdraw pending requests; Guild Leaders approve/reject. Approval rechecks active membership, reciprocal ownership, eligibility and the original character snapshot inside the transaction. A stale request stays pending with an explicit error until rejected/withdrawn and resubmitted.

Main promotion queries the current direct alts and atomically moves the reciprocal account link, promotes the selected alt and reparents the old main and all other direct alts. New alts receive a server-generated roster ID reserved in the request and are created only on approval; existing alts retain their IDs. Teams, sign-ups, loot and immutable historical snapshots are never rewritten. Legacy name-only loot matching can lose a dashboard match after a rename; the stable-ID loot migration remains LOOT-003, not this request workflow. Class/spec/default-role data lives once in `functions/characterClasses.json`, imported by the server and `shared/game/classes.ts`; the location is necessary for the Functions deployment bundle. `shared/game/players.ts` defines the roster record type, re-exported by `guildApi.ts`. Server authentication/input/membership helpers are shared with raid callables through `functions/access.js`. Deploy Functions first, rules second, then Hosting.

Member Access removal uses `shared/members/access.ts` through `guildApi.ts`: a client transaction sets the existing membership's role to `Removed`, clears `playerId` and releases the reciprocal `linkedUid`. `Removed` is a membership status, not an active `GuildRole`; existing rule predicates and server callable role allowlists deny it access. Rules enforce Guild Leader-only changes, no self-removal and restoration only to an unlinked Member. `useGuildSession` displays a dedicated removed-access screen using the account's readable own membership record, including live revocation; invalid roles fail explicitly rather than activating the app. Guild subscriptions stop and their in-memory records are cleared when access is lost. VIEW AS never participates in these decisions. Characters, assignments and historical documents are not deleted or renamed by removal, and already-downloaded data cannot be recalled.

Raid zone snapshots are compared by ordered zone values (`id`, `name`, `size`) in `shared/raids/zoneSnapshots.ts`, not by JSON text. Firestore map key order is not significant; logging an unchanged zone list as changed makes the audit entry inconsistent and the batch is refused.

The rules decide who may write and check a few shapes (a member's role, the allowed keys of a join request), but they do not require the fields the UI reads or check their types, and roster, lootPriorities and awards written by a Guild Leader are free-form. So the client does not trust what it reads. `subscribeGuildCollection` passes each document of those five collections through a normalizer in `shared/lib/normalize.ts` before it reaches `useGuildData`. A field the UI reads gets a safe default (text `''`, lists `[]`, non-string list entries dropped), every other field passes through unchanged, and a document that cannot be used (a name or item that is missing or not text, an unknown role or status) is skipped. Skipped documents are counted in `data.unreadable`, which the shell shows to Guild Leaders as "N records could not be read", and named by collection and id in a console warning. If a feature starts reading a new field from one of these collections, add it to that collection's normalizer. raids, afkEntries and teamAssignments are validated by the rules and are read as they are. `guildApi.ts` and `useGuildData.ts` import `shared/lib/normalize.ts` at runtime; `normalize.ts` must keep its import from `guildApi.ts` type-only so the two never import each other at runtime.

Guild settings (`guilds/<id>/settings/general`) are a single document read through `normalizeSettings` in the same file: it never drops the document, and every missing or invalid field falls back to `defaultGuildSettings` in `shared/game/settings.ts`. A failed read (for example rules not deployed yet) keeps the defaults and logs a console warning rather than showing an error. Anyone in the guild may read it, only a Guild Leader may write it, and the rules require exactly the expected fields: the two phases with a status label and tone each, the council status, and the 	eamNames (10-player) and groupNames (20- and 40-player) maps. Deploy the rules before hosting a build that saves settings.

Render errors are contained by `shared/ui/ErrorBoundary`: one around the workspace panel (reset when the tab changes), one around the dialog host (reset when the open dialog changes) and one around the whole app in `main.tsx`. A boundary adds no element when nothing has thrown, and a healthy panel stays mounted across tab switches. Once it has caught an error it stays up until its `resetKey` changes (the tab id, or the open dialog's key) or the page reloads, even if the data heals. It does not catch errors in event handlers or async code.

## Help and popovers

Use `shared/ui/HelpPopover.tsx` for explanatory help and expandable read-only text. Pass an accessible `label`, the button's `trigger` content, and the panel's `children`; `triggerClassName` can preserve an existing button layout. Do not nest it inside another button or a label, or put a mutation on its trigger. Dashboard raider-type help is a separate control so reading it cannot save a preference.

The shared component uses a native auto popover in the top layer, without a layout wrapper. Tap/click, Enter and Space toggle it; desktop coverage details also use this explicit activation instead of hover. Only one auto popover is open at once. Escape closes it and restores trigger focus. Outside pointer/click interaction, focus leaving the trigger/panel, page or nested-container scrolling, and viewport resize/scroll dismiss it. Scrolling or interacting inside the panel does not dismiss it. Navigation normally unmounts the component, and navigation clicks dismiss it before switching context. Panels are viewport-constrained, scrollable and positioned above the trigger when there is insufficient room below; opening them must not change table row height.

Use a separate help trigger for disabled controls that need an explanation. Native `title` may supplement an action's visible/accessibility label, but must not be the only way to read substantive help. Do not add a second bespoke tooltip implementation. Keep native popovers as read-only help, not a replacement for the dialog host or an authorization boundary.

Before shipping a migrated use, check tap and keyboard activation, Escape/focus return, outside interaction, one-open behavior, page and nested scrolling, scrolling long panel content, viewport edges at narrow widths, light/dark themes and unchanged surrounding layout. Pure positioning regression cases live in `tests/unit/popover-position.test.ts`; dismissal and native activation require a browser check.

## CSS

`App.css` holds the shared layout and primitive styles and is global. `./App.css` must stay the last stylesheet import in `App.tsx`: several selectors rely on load order and on `:nth-child` positions, so do not add wrapper elements or reorder children inside existing components. A feature that needs new styles adds its own stylesheet with a unique prefix on every class (for example `.cov-...`), imports it from the feature, and does not edit another feature's stylesheet. `AfkCalendar.css` is the existing example.

Keep `.table-scroll` positioned: it contains absolutely positioned accessibility labels inside wide tables. Without that containing block, visually hidden column labels can escape the table's scroll boundary and widen the mobile page. Verify the document stays viewport-width while the table and mobile navigation still scroll independently; root-level overflow clipping alone does not prevent this.

## Known quirks (unchanged on purpose)

The notice banner is never cleared, and the error and notice banners persist across tab switches. The history footer shows the filtered count for both numbers. Assigning, unassigning and reordering do not set the busy flag. The "last Guild Leader" guard is UI-only. The modal has no Escape key or focus trap. These predate the module split; fix them in their own PRs.
