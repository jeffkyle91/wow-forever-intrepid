# Contributing

Thanks for helping. This is a guild tool with real data in production, so the rules are about keeping that safe and keeping changes easy to review. Read `ARCHITECTURE.md` for how the code is laid out.

## Set up

Use the Node.js version given in the README.

```bash
npm install
npm ci --prefix functions --ignore-scripts
cp .env.example .env.local   # then fill in your own Firebase values
npm run dev
```

Prefer `npm run dev:emulator` for local work: Auth, Firestore and Functions run against `demo-intrepid` without billing. For cloud development use your **own** Firebase project with Email/Password sign-in, Firestore, rules, Functions and your own `VITE_GUILD_ID`. Cloud Functions requires the Blaze plan; Spark no longer supports the complete sign-up/availability write flow. Follow "Firebase project setup" in the README. Never point `.env.local` at the production project, and never commit `.env.local`.

Awards and raids cannot be deleted from the app (unavailable dates can only be removed by their owner), so test on your own project and not on the live guild.

## Before you open a pull request

```bash
npm run build
npm run lint
npm run test:unit
```

If you changed `firestore.rules`, also run `npm run test:rules` (see "Testing the Firestore rules" below).

Then click through every tab as each role (use VIEW AS as a Guild Leader to preview Raid Leader and Member), open each dialog you touched, and make sure the browser console is clean. Automated checks cover the Firestore rules, the pure raid-preview helpers and the pure functions in `tests/unit/` (`npm run test:unit`, run directly by Node, no emulator), not the rendered UI, so say in the PR what you checked in the app.

For explanatory help or expandable read-only text, use the shared `HelpPopover` and follow [its interaction and browser-check contract](ARCHITECTURE.md#help-and-popovers). Do not put essential help only in `title` or hover handlers. Reading help must never trigger a save or change a selection.

## Testing the Firestore rules

The rules are the authorization boundary, so they have tests that run against the local Firestore emulator. You need a JDK, version 21 or newer, because the emulator is a Java program (check with `java -version`; Temurin from adoptium.net is fine, or `brew install openjdk@21` on macOS, which also needs adding to your `PATH`). Then:

```bash
npm run test:rules
```

It takes under a minute and needs no Firebase login, no Firebase project and no `.env.local`: it uses the demo project `demo-intrepid`, and the tests talk only to the emulator on `127.0.0.1`. The script runs `firebase-tools` through a version-pinned `npx` call (it is deliberately not a dependency of this repo, with install scripts turned off), and the first run downloads the emulator jar (about 137 MB) into your user cache. The emulator port is in `firebase.json` (`emulators.firestore.port`); change it there if it clashes with something on your machine.

The tests are in `tests/rules/`, written in TypeScript and run by Node's built-in test runner. `access-matrix.test.ts` lists, per collection, which role may get, list, create, update and delete; the other files cover the rules that depend on the data (join requests, the account-to-character link, award snapshots, availability, raid zones and raids, and how large a batch can be). A comment above each group says who may do what.

- Change a rule and its tests in the same pull request. Add a case for every new branch, and for the thing it must still refuse.
- Raid-rule changes must keep ten-zone creation and audited edits passing, including an edit of every mutable detail and cancellation/restore. Retain malformed-snapshot and dishonest-audit refusals; testing only a smaller zone list can hide Firestore's 1000-expression limit.
- Tests named "KNOWN GAP" record what the rules do today even though it is arguably wrong or weak. They are not approvals. When a rules change closes a gap, that test fails: flip it to expect a refusal and remove the label.
- `tests/rules/support/client.ts` repeats the multi-document batches from `src/guildApi.ts`. If you change how `approveJoinRequest` or `updateMembershipAccess` build their batches, change the copy too.
- Use invented names and uids in tests, as everywhere else in this repository.
- `npm run build` does not compile the tests and `npm run lint` only lints them; `npx tsc -p tests/rules` and `npx tsc -p tests/unit` type-check them (CI does not run that).
- `npm run test:rules` also runs pure raid-preview/availability checks in `tests/raid-preview.test.ts` and server-handler integration checks in `functions/raids.test.js`. Install `functions/` dependencies first. Server tests use the Admin SDK only against the local emulator and test authorization, ownership, inclusive/overlapping ranges, retained Absent after removal, concurrent mutations and idempotent synchronization. Run pure checks alone with `node --test tests/raid-preview.test.ts`.
- The same runner includes `functions/characters.test.js`: request ownership, Guild Leader-only review, stale approvals, default roles, withdrawal/rejection and atomic main swaps. Request privacy and direct-write denials are tested in `tests/rules/character-requests.test.ts`. Client and server share `functions/characterClasses.json`; change it once and keep the role-default regressions passing.

## Pull requests

Character-readiness changes must keep `tests/rules/character-readiness.test.ts` passing: per-character owner/leader writes, reciprocal main/direct-alt ownership, removal, server stamps and field isolation. Leadership aggregation is covered in `tests/unit/leadership.test.ts`. Shared coverage changes also require `node --test tests/raid-coverage/*.test.ts`; the module is in `src/shared/raid-coverage/` and is reused by Teams and Leadership.

- Keep them small and about one thing. A refactor and a feature are separate PRs.
- Work in your feature's folder under `src/features/`. If you must change a shared file, do it in its own commit and call it out in the PR description. Shared files are: `src/shared/**`, `src/shell/**`, `src/App.tsx`, `src/App.css`, `src/guildApi.ts`, `src/useGuildData.ts`, `src/useGuildSession.ts`, `src/security.ts`, `firestore.rules`, `firebase.json`, `package.json`, `package-lock.json`, `.nvmrc` and everything under `.github/`.
- A change that adds or changes a Firestore collection or a rule needs the rules change in the same PR, reviewed on its own, tests for it in `tests/rules/`, and a note about deploy order: rules first, then hosting.
- Deploy only when you are asked to. For this server-side write transition deploy Functions first, then rules, then hosting. Functions requires Blaze billing and Node 24. After the first release a Guild Leader runs Settings > Synchronize raid absences to backfill existing unavailable dates. Old tabs must refresh: direct response/availability writes are now denied.
- Opening a PR: `gh pr create --fill` (GitHub CLI). The merge is done in GitHub.
- After the merge, a maintainer asks for the deploy. `npm run release` from a clean `main` that matches `origin/main` runs the read-only checks and prints the plan (and refuses if the build would use a Firebase project other than the live one). `npm run release -- --deploy` then builds, lints, runs server/rules tests, deploys Functions, Firestore rules, then hosting, then moves the `last-deploy` note. Any other argument is an error, so `--help` and typos cannot deploy.
- Match the existing style. There is no formatter yet, so do not reformat code you are not changing; it makes the diff unreadable.

## Backlog, patch notes, and publishing

### Sources of truth

- [Roadmap](docs/ROADMAP.md): direction, policy decisions, milestones and dependencies. Do not maintain a second task-status list there.
- [Backlog](docs/backlog.json): canonical actionable work and status, including released/cancelled records retained for history.
- [Changelog](CHANGELOG.md): member-facing changes grouped by verified release.
- [Publisher guide](docs/discord-backlog.md): local credentials, message tracking, previews, publishing and recovery.

Discord is a published view, not the authoritative work tracker. Collaborators propose changes through PRs. The primary maintainer deploys and publishes from the designated Windows machine; collaborators do not need webhook credentials or local Discord tracking files. A merge, build or deployment does not itself authorize a Discord post.

### Maintaining backlog items

Each item has these required fields:

| Field | Rule |
| --- | --- |
| `id` | Permanent unique identifier, such as `RAID-001`. Check current main and open PRs before allocating one; never reuse or rename an ID. |
| `title` | A concrete outcome, not an implementation diary. |
| `status` | `planned`, `in-progress`, `awaiting-deployment`, `released`, or `cancelled`. |
| `priority` | `critical`, `high`, or `normal`. Reserve critical for the firm first-raid path. |
| `target` | ISO date or `null` when unscheduled or externally blocked. Around December 15 remains approximate even though the sortable target is `2026-12-15`. |
| `commitment` | `required`, `target`, or `external-dependency`; a target is not a guaranteed delivery date. |
| `dependsOn` | Existing item IDs for actual prerequisites, with no self references or cycles. Unknown research outcomes belong in notes rather than guessed dependencies. |
| `prs` | Relevant PR numbers in this repository; an empty array means no PR is recorded. |
| `release` | `null` until verified adoption/release, then the exact changelog release heading. |
| `notes` | Remaining scope, acceptance conditions, policy questions, external risks and fallback behavior. Public-safe text only. |

Claim work as `in-progress` when implementation starts. A merged application change becomes `awaiting-deployment`, not `released`. After production deployment and verification, the primary maintainer records its release. Local tools require verified installation/adoption instead; they must not be described as deployed web features. Keep blocked items at their current status and explain the blocker in notes.

For partial delivery, keep the original item open with explicit remaining scope, or split the remaining outcome into a new ID and record the relationship. Only completed scope belongs in patch notes. Retain cancelled records with a reason; cancelling or reprioritizing work is not a shipped feature. Preserve released records and IDs, but omit them from the active Discord backlog. Removing a feature later is a new change, not erasure of the earlier release.

Initial priorities and dates are a working breakdown of the approved roadmap, not additional firm deadlines. The December 9 scheduled-raid/sign-up/starting-snapshot requirement remains firm; loot recording has a spreadsheet fallback, priorities start around December 15, and December 22 is the broad full-rollout target. Resolve conflicts with the maintainer rather than silently changing commitments.

### Maintaining patch notes

Include relevant backlog status/scope updates in implementation PRs and concise member-facing bullets under **Unreleased**, referencing their backlog IDs. Describe what members can do or what changed, not internal filenames. Internal-only tooling and documentation need not generate member-facing notes. Unreleased is not evidence of production availability.

After deployment and verification, the primary maintainer moves only the shipped bullets into a heading `YYYY-MM-DD - <full-or-short-commit>`, records source PRs, and updates completed backlog items with `status: "released"` and that exact heading in `release`. Leave merged-but-unshipped bullets under Unreleased. Preserve existing release entries; explicitly label corrections to published notes instead of silently rewriting history. Do not invent historical backlog IDs or retrospectively mark planned work complete.

### Publishing ownership and approval

1. Collaborators update the shared files in reviewed PRs.
2. The primary maintainer deploys the approved application changes and verifies production.
3. Finalize the release record and backlog statuses through the normal reviewed change process. Publishing does not require another Firebase deployment for documentation-only changes.
4. Preview the exact Discord content and destination; obtain explicit approval to publish.
5. Post a new patch-notes message for the verified release and update existing active-backlog messages. Record receipts locally and recover partial failures without duplicating posts.

The publisher renders shared sources with `.\scripts\discord-backlog.ps1 -Backlog` or `-Release '<exact dated changelog heading>'`; both default to preview. After explicit approval, add `-Publish`. Release mode publishes patch notes first, then updates the active backlog, saving receipts so known successful messages are skipped on retry. It does not verify Firebase deployment itself: the maintainer must first verify deployment and record it in the changelog. Configure patch notes using `-ConfigureFromClipboard -Destination patch-notes`; the existing backlog credential stays intact. See [publisher instructions](docs/discord-backlog.md) for setup, recovery and manual payload support. Neither merge nor deployment triggers Discord automatically.

Keep encrypted webhook credentials, Discord receipts/message IDs, locks and private guild content outside the repository. The primary machine owns publishing state; other machines must not publish independently using fresh state. Verify JSON syntax, unique IDs, field values, references, acyclic dependencies and release links when editing the backlog. Documentation-only changes need no app build unless behavior or tooling changes too.

## Rules that protect the guild

- Firestore security rules are the direct-client authorization boundary. Availability and raid-response writes are denied by the rules and go through authenticated server callables that enforce membership, ownership and availability. UI role checks only hide controls; never relax direct-write rules to work around a callable failure.
- The VIEW AS preview only changes what the UI shows. Do not pass a previewed role to data hooks or write helpers.
- Award snapshots (candidate order and council note at decision time) are immutable. Do not alter how they are built or stored without discussing it first.
- Do not imply that local browser data is shared. Only authenticated Firestore data is.
- This repository is public. Do not commit real character names, account emails, Firebase service-account files or keys, or anything from a private guild spreadsheet or tracker. Use invented names in examples and tests.
- The class and specialization icons are Blizzard artwork used under the fan-content note in the README. Do not add other Blizzard assets.

## Using an AI assistant

Assistants such as Copilot and Claude Code work well here if they read `ARCHITECTURE.md` first. Point them at it, keep them inside one feature folder, and review what they change in shared files line by line. Do not let one reformat `src/App.tsx`.
