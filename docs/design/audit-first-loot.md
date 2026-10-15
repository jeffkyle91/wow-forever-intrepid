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

**`auditLog/{entryId}`** (new, per guild), entry id = `{targetId}_{rev}`:

| Field | Meaning |
| --- | --- |
| `at`, `by`, `byName` | server time, uid, display name at the time |
| `targetType`, `targetId`, `rev` | `award` or `priority`, which document, which revision |
| `action` | `create`, `edit`, `remove`, `reorder`, `delete` |
| `item` | the item name, so the log reads without joins |
| `changed` | list of changed field names |
| `before`, `after` | the old and new values of the changed fields |
| `reason` | optional text, up to 300 characters (required for `remove`) |

The id comes from the target and its revision, so it needs no random ids, cannot be reused, and the rules can compute it.

## Rules

- `auditLog`: read for every guild role; create only by a Guild or Raid Leader with `by == request.auth.uid`, `at == request.time`, an allowed key list and size caps; **update and delete are denied for everyone.**
- Awards: create and update require the audit entry in the same batch, checked with `getAfter()` and `exists()` (the entry must not exist before the batch, and must name this document, this revision, this actor and this time). Update also requires `rev == old rev + 1`, the immutable fields unchanged, and a reason when status becomes `removed`. Delete stays denied.
- Priorities: same pattern for create, update and delete.
- The Guild Leader exception in the award create rule (which skips the snapshot check) goes away together with the local-preview import, so there is one validated way to create an award.
- What the rules cannot prove: the `before` and `after` values in an entry are written by the client. A leader with a modified browser could record wrong values, but could not make a change without an entry, hide who made it, or edit the entry afterwards. Comparing selected fields can be added later.

Each audited write is two documents in one atomic batch. The rules do 2 to 3 extra lookups per write, well inside Firestore's limit.

## Client

- `guildApi.ts` gets audited helpers (`createAward`, `editAward`, `removeAward`, `savePriority`, `reorderPriority`, `deletePriority`) that build the batch; no other code writes these collections.
- History tab: leaders see an Edit button on each award, with a reason box; removed awards are hidden behind a "show removed" toggle and shown struck through.
- New "Audit log" tab for every role. It subscribes only while open (newest 100 entries, then "load more") so the global subscriptions and the read budget do not grow.
- Positional priority completion and filters ignore removed awards.
- Order within one night: sort by `awardedAt`, then `createdAt`, then id.

## Rollout

- No migration: documents without the new fields keep working.
- Rules and hosting must ship together: an old cached client that creates an award without an audit entry is refused by the new rules until the page reloads.
- Docs that say awards are immutable (`AGENTS.md`, `README.md`, `ARCHITECTURE.md`, `.github/copilot-instructions.md`) change in the same pull request that changes the rules.

## Plan (small pull requests, tests first)

1. Rules and tests: `auditLog` and the same-batch helper, proven on the emulator before any client code.
2. Rules and tests: awards (create shape, edit, remove) and priorities.
3. Client helpers in `guildApi.ts` (shared file, own commit).
4. History edit and remove, priority audit.
5. Audit log tab.
6. Delete the local-preview import and update the docs.

## Questions for review

1. Should Raid Leaders edit awards, or only Guild Leaders? Proposed: both (Raid Leaders make awards today).
2. Is a reason required for edits? Proposed: required for removing, optional otherwise.
3. Should every priority reorder be one log entry? Proposed: yes (simple); noisy, but easy to collapse in the view later.
4. Should removed awards be hidden by default? Proposed: hidden, with a toggle.
