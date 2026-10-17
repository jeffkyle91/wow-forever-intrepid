# Design: audit-first loot (issue A2)

Status: partially implemented. Stage 1 rules support audited award edits and append-only audit entries. The full client correction/removal workflow, audit-log reader, audited award creates/priority writes and tightened stage 3 rules remain planned. This document describes the target design, not the complete current behavior.

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
| `rev`, `createdBy`, `createdAt` | 1, the uid of the leader, and server time |

The create rule (`validManualAward`) applies when the document has no `priorityId`. Guild and Raid Leaders may write it; it allows exactly the fields above (no status, no `updatedBy`/`updatedAt`: a new award is active), checks their types and sizes, requires the roster character to exist with that name, and requires the audit entry (type `award`, revision 1) in the same batch. The entry's own rule is unchanged: it has to describe the new document truthfully. `decision` is part of what an entry may list and must log, and it can be corrected later like any other field (with an entry); the snapshot fields can never be added to a manual award afterwards. A document with a `priorityId` follows the snapshot rule exactly as before.

Not changed here: the Guild Leader exception in the create rule (it goes away in stage 3, with the local-preview import), and the date check, which tests the format only.

## Rules

- `auditLog`: read for every guild role; create only by a Guild or Raid Leader with `by == request.auth.uid`, `at == request.time`, an allowed key list and size caps; **update and delete are denied for everyone.**
- Awards: an update requires the audit entry in the same batch, checked with `getAfter()` (the entry must name this award and the next revision). The entry's own rule requires the award in the same batch to carry that revision, so each needs the other. Update also requires `rev == old rev + 1`, the immutable fields unchanged, and a reason when status becomes `removed`. Delete stays denied.
- The entry has to describe the change truthfully, and the rules check it against the stored document: the fields in `changed` are exactly the fields that differ, `before` and `after` hold the stored old and new values, `item` is the award's item, a `remove` is a change to `status: removed` with the same reason the award carries, and a `reorder` changes only `rankedPlayers`.
- Priorities: the same entry rules apply to an audited create, edit, reorder or delete (stage 1 does not yet require priority writes to carry an entry; see the rollout).
- The Guild Leader exception in the award create rule (which skips the snapshot check) goes away together with the local-preview import, so there is one validated way to create an award.
- What the rules still cannot prove: that a leader's `byName` is a real name (it is the member's stored display name, which a Guild Leader can change), and that `reorder` is a pure reordering (a candidate added or removed can be filed as a reorder; the before and after lists show it). The uid in `by` is always the real actor.

Each audited write is two documents in one atomic batch. The rules do a handful of document lookups per write, and a batch is limited to 20: on the emulator 18 audited edits fit in one batch and 19 do not. A bulk import has to chunk its batches.

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
3. **Stage 3, rules (tighten).** Once the client is live, the rules require an entry for award create and for every priority write, constrain award create (`rev` 1, `createdBy`, `createdAt`, a key list, field limits) and bound the priority fields, so the log can no longer be bypassed by writing through the old path. An old cached client is refused after this stage until its page reloads.

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
