# Design: audit-first loot (issue A2)

Status: stage 1 and stage 3 of the rules are implemented. Awards can be edited only with an audit entry, a new award and every priority create, edit and delete need one too (`validPriorityAward`, `validManualAward`, `validPriorityCreate`, `validPriorityEdit`, `validPriorityDelete`), and audit entries are append-only. The client side (the audited helpers, the audit log screen inside Loot priorities) is built in the pull request that follows these rules; correcting and removing an award from the History tab is still planned (LOOT-004).

Rollout follows [the roadmap](../ROADMAP.md): target recording loot from the first raid on December 9, 2026, independently of priority listings; adopt priorities around December 15; target full audits and all remaining functionality by December 22. If recording is not ready for December 9, use need-before-greed rolls and a spreadsheet, followed by a validated upload. That upload and priority-independent recording path still need implementation; do not fabricate a candidate-order or council-note snapshot for an award decided by rolls. Preserve the actual raid/award date separately from later entry/audit timestamps.

## What it must do

- Guild Leaders and Raid Leaders can correct awards and priorities after the fact.
- Every change is recorded in a log nobody can edit or delete from the app; every guild member can read it.
- The as-awarded snapshot (candidate order and council note at decision time) never changes.
- Awards are never deleted; "removing" one is an edit that marks it removed, with a reason.
- A modified browser cannot skip the log: the rules enforce it.

## Data model

**`awards/{awardId}`** keeps its fields and gains:

| Field | Meaning |
| --- | --- |
| `rev` | integer, 1 on create, +1 on every edit |
| `createdBy`, `createdAt` | uid and server time of the award; never change |
| `updatedBy`, `updatedAt` | uid and server time of the last edit |
| `status` | `active` (default) or `removed`; `removedReason` is required when removed |
| `recipientId` | optional roster id (filled in by issue A3; included now so the allowed keys are written once) |

`prioritySnapshot` and `councilNoteSnapshot` are immutable after create. Old awards without these fields still load and can be edited; the first edit sets `rev` to 1 and they show as "recorder unknown".

**`priorities`** (`lootPriorities/{id}`) gain `rev`, `updatedBy`, `updatedAt` and are audited the same way, including reorders and deletes.

**`auditLog/{entryId}`** (new, per guild), entry id = `{type}_{targetId}_{rev}` (for example `award_Xk3f_2`):

| Field | Meaning |
| --- | --- |
| `at`, `by`, `byName` | server time, uid, display name at the time |
| `targetType`, `targetId`, `rev` | `award` or `priority`, which document, which revision |
| `action` | `create`, `edit`, `remove`, `reorder`, `delete` |
| `item` | the item name as it was before the change (as created, for a create), so the log reads without joins |
| `changed` | list of changed field names |
| `before`, `after` | the old and new values of the changed fields; a create has no `before`, a delete no `after` |
| `reason` | optional text, up to 300 characters (required for `remove`) |

The id comes from the target type, the target and its revision, so it needs no random ids, cannot be reused, and the rules can compute it. The type keeps an award and a priority that share an id from sharing entry ids (otherwise a leader could permanently block corrections to an award by filing a priority entry under its next id). The revision has to be a whole number.

## Manual awards (LOOT-002)

Priorities are not adopted until around December 15, so the first raid is decided by need-before-greed rolls and the council. A **manual award** records such a decision without a priority list. It is an award with no `priorityId`, no `prioritySnapshot` and no `councilNoteSnapshot`: nothing pretends that a candidate order existed, and the snapshot rule is not weakened for awards that have one.

| Field | Meaning |
| --- | --- |
| `item`, `encounter`, `awardNote` | as for any award; `encounter` and `awardNote` may be empty text |
| `recipientId` | the roster character's id (required) |
| `recipient` | that character's name as the roster has it when the award is made; a later rename does not rewrite the award |
| `awardedAt` | the raid date, `YYYY-MM-DD`. It is kept apart from `createdAt`, the time the award was entered, so a spreadsheet upload or a late entry never looks like a decision made later |
| `decision` | how it was decided: `roll`, `council` or `other` |
| `phaseNo` | the loot phase it belongs to: a whole number from 0 to 30 (see "Loot phases" below). Required, so a phase can never be guessed later |
| `rev`, `createdBy`, `createdAt` | 1, the uid of the leader, and server time |

The create rule (`validManualAward`) applies when the document has no `priorityId`. Guild and Raid Leaders may write it; it allows exactly the fields above (no status, no `updatedBy`/`updatedAt`: a new award is active), checks their types and sizes, requires the roster character to exist with that name, and requires the audit entry (type `award`, revision 1) in the same batch. The entry's own rule is unchanged: it has to describe the new document truthfully. `decision` is part of what an entry may list and must log, and it can be corrected later like any other field (with an entry); the snapshot fields can never be added to a manual award afterwards. A document with a `priorityId` follows the snapshot rule exactly as before.

Not changed here: the date check, which tests the format only (`2026-13-45` passes, as it does for every other date in the rules). The Guild Leader exception in the create rule is gone (stage 3): a Guild Leader's award follows the same rules as a Raid Leader's.

## Loot phases

The loot lists are kept per phase (a priority and an award carry `phaseNo`; none means phase 0). The current phase's number is the length of `phaseHistory` in the settings document, the names of the finished phases, oldest first. `validGuildSettings` accepts that list only when it is unchanged, grows by one name (the name the current phase had, with `currentPhase` becoming the new name) or shrinks by one (the last name becomes `currentPhase` again and the phase being left becomes `nextPhase`), at most 30 names, so a Guild Leader cannot quietly move the phase back or rewrite its history. The first save of a guild's settings (no document stored yet) may close only "Launch prep", the name the app shows until then. `phaseNo` (0 to 30) is checked wherever an award is created or edited, is part of what an award entry may list and must log, and can be corrected like any other field, with an entry (a correction cannot take it away). The rule that a closed phase cannot be written to comes with the priority rules in stage 3.

## Rules

- `auditLog`: read for every guild role; create only by a Guild or Raid Leader with `by == request.auth.uid`, `at == request.time`, an allowed key list and size caps; **update and delete are denied for everyone.**
- Awards: an update requires the audit entry in the same batch, checked with `getAfter()` (the entry must name this award and the next revision). The entry's own rule requires the award in the same batch to carry that revision, so each needs the other. Update also requires `rev == old rev + 1`, the immutable fields unchanged, and a reason when status becomes `removed`. Delete stays denied.
- The entry has to describe the change truthfully, and the rules check it against the stored document: the fields in `changed` are exactly the fields that differ, `before` and `after` hold the stored old and new values, `item` is the award's item, a `remove` is a change to `status: removed` with the same reason the award carries, and a `reorder` changes only `rankedPlayers`.
- Priorities: a create, edit or delete is accepted only with its entry (stage 3). A priority carries `rev`, `updatedBy` and `updatedAt` (stamped by the rules), its fields are bounded (item up to 120 characters, encounter 120, at most 60 candidates, note 500, item, dungeon and creature ids whole numbers up to 100 million), and it can be written only in the current loot phase or the next one; its phase and the priority it was carried from can never change. A field that is not changed is not checked again, so a priority written before these limits can still be reordered. Entry ids are `{type}_{id}_{rev}` and an entry can never be written twice, so **the id of a deleted priority cannot be created again**: the app gives every new priority a fresh id.
- The Guild Leader exception in the award create rule is gone: every new award has exactly the expected fields, `rev` 1, `createdBy` and `createdAt` set by the rules, the current phase's number, a snapshot equal to the priority it copies (and that priority is in the current phase), and its entry in the same batch.
- What the rules still cannot prove: that a leader's `byName` is a real name (it is the member's stored display name, which a Guild Leader can change), and that `reorder` is a pure reordering (a candidate added or removed can be filed as a reorder; the before and after lists show it). The uid in `by` is always the real actor.

Each audited write is two documents in one atomic batch. The rules do a handful of document lookups per write, and a batch is limited to 20: on the emulator 18 audited edits fit in one batch and 19 do not. A bulk import has to chunk its batches. Measured on the emulator with the settings document stored (the phase rules read it): 16 audited priority creates, edits or deletes fit in one batch, 14 awards from one priority, 5 awards each from a different priority (`tests/rules/batch-budget.test.ts` pins these). The app sends at most 10 in a batch.

## Client

- `guildApi.ts` gets audited helpers (`createAward`, `editAward`, `removeAward`, `savePriority`, `reorderPriority`, `deletePriority`) that build the batch; no other code writes these collections.
- History tab: leaders see an Edit button on each award, with a reason box; removed awards are hidden behind a "show removed" toggle and shown struck through.
- New "Audit log" tab for every role. It subscribes only while open (newest 100 entries, then "load more") so the global subscriptions and the read budget do not grow.
- Positional priority completion and filters ignore removed awards.
- Order within one night: sort by `awardedAt`, then `createdAt`, then id.

## Rollout: expand, then client, then tighten

The rules are shipped in stages so nothing breaks while the client catches up:

1. **Stage 1, rules only (additive).** The `auditLog` collection and audited award edits are allowed. Creating an award and writing a priority still do not need an entry, so the current client keeps working and these rules can be deployed before any client change.
2. **Stage 2, client.** The client writes audited creates, edits, removals, reorders and deletes through the helpers in `guildApi.ts`, and the new History and Audit log screens.
3. **Stage 3, rules (tighten): done in the rules pull request "audited loot".** The rules require an entry for award create and for every priority write, constrain award create and the priority fields, and the Guild Leader exception is gone. An old cached client is refused after this stage until its page reloads.

- No migration: documents without the new fields keep working.
- Docs that say awards cannot be updated change in the same pull request as the rules (this one: `AGENTS.md`). The statements that award snapshots are immutable stay true.

## Plan (small pull requests, tests first)

1. Rules and tests: `auditLog`, audited award edits and truthful entries (stage 1), proven on the emulator before any client code.
2. Client helpers in `guildApi.ts` (shared file, own commit).
3. History edit and remove; priority audit.
4. Audit log tab.
5. Rules stage 3, then delete the local-preview import and update the remaining docs.

## Decisions from review

Answered by the guild leaders on the pull request that added this document:

1. Raid Leaders may edit awards too, not only Guild Leaders.
2. A reason is optional for edits and required only when removing an award.
3. Every priority reorder is one log entry.
4. Removed awards are hidden by default, with a toggle.
