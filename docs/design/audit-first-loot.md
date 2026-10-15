# Design: audit-first loot (issue A2)

Status: proposal for review. Nothing here is built. It turns the decisions in `docs/ROADMAP.md` into a data model and rules so the first awards (needed by the first raids, 2026-12-09) are saved in the shape we keep.

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
