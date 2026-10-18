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

### Branch cleanup after merge

The primary maintainer merges PRs and normally deletes their remote feature branches immediately afterward using GitHub's **Delete branch** button. Contributors must clearly mark **KEEP BRANCH: YES** in the PR's Branch retention section before merge if a branch is still needed, with the reason, owner and linked dependent work. Otherwise the maintainer will treat it as disposable after merge, subject to the safety checks below. Keep this field current and notify the maintainer if the requirement changes during review. Each contributor handles their own local branch cleanup separately.

Clean up one verified PR branch at a time, not unrelated branches. Coding assistants must surface any known reason to retain a branch prominently in the PR; they still need explicit approval naming the branch before performing deletion themselves. This maintainer-operated default is not permission for automated or bulk deletion.

1. **Verify the exact branch and merge.** Check that GitHub shows the PR as merged into the intended base, not merely closed. Confirm the head repository and branch name, fetch current refs, and compare the current remote branch tip with the PR's merged head commit. If more commits were pushed afterward, stop: those commits are not covered by the merge.
2. **Check retention and dependencies.** Read the PR's Branch retention section and check for dependent open/stacked PRs or known shared use. Honor **KEEP BRANCH: YES** until the named owner confirms it can be removed. Missing retention information on an older PR or conflicting evidence of ongoing use requires coordination with the owner before deletion; an explicit **KEEP BRANCH: NO** on a current PR needs no separate routine confirmation. A contributor's leftover local checkout alone does not require keeping the remote branch, but ongoing work depending on it does. Never delete `main`, another protected/long-lived branch, or deployment refs such as the `last-deploy` tag. Do not choose branches for deletion based only on age, naming or a bulk "merged" list.
3. **Delete only the approved remote branch.** Prefer the merged PR's **Delete branch** button after the checks above. For a branch in this repository, the equivalent command is `git push origin --delete <exact-branch-name>`; substitute only the verified branch, with no wildcards or bulk loops. A fork branch belongs to its owner; do not assume `origin` points to that fork. Recheck the remote tip immediately before deletion and stop if it changed.
4. **Clean your own local checkout separately.** Inspect `git status --short` and preserve any uncommitted work before switching. With a clean checkout, fetch/prune the approved remote, switch to `main`, and fast-forward it. Stop on any failure; never reset or discard changes to make cleanup succeed. Pruning removes stale local remote-tracking refs, not other people's remote branches. If `main` cannot fast-forward, ask for help rather than forcing it.

   ```powershell
   git fetch origin --prune
   git switch main
   git merge --ff-only origin/main
   git merge-base --is-ancestor <exact-local-branch-name> origin/main
   # Only if the ancestry check succeeds and the branch is no longer needed:
   git branch -d <exact-local-branch-name>
   ```

   Run each command separately and check its result. The explicit ancestry check guards against deleting local work just because its upstream contains it. `git branch -d` is an additional guard, not proof of the PR's status. If the branch is checked out in another worktree, stop and coordinate; do not remove the worktree to bypass the refusal.
5. **Treat squash/rebase merges specially.** Their original commits may not be ancestors of `main`, so the ancestry check or safe deletion can refuse even when the intended changes landed. Do not automatically substitute `git branch -D`. Verify the merged PR, compare its delivered changes with the current local branch, preserve any unique work, and request explicit approval for that exact local force-deletion if still necessary. Uncertainty means keep the branch.

Branch deletion does not deploy, mark a backlog item released, close unrelated issues or authorize Discord publication. Start subsequent work on a new branch from current `main`, rather than reusing the merged branch.

## Backlog, patch notes, and publishing

### Sources of truth

- [Roadmap](docs/ROADMAP.md): direction, policy decisions, milestones and dependencies. Do not maintain a second task-status list there.
- [Backlog](docs/backlog.json): canonical actionable work and status, including released/cancelled records retained for history.
- [Changelog](CHANGELOG.md): member-facing changes grouped by verified release.
- [Publisher guide](docs/discord-backlog.md): local credentials, message tracking, previews, publishing and recovery.

Discord is a published view, not the authoritative work tracker. Collaborators propose changes through PRs. The primary maintainer deploys and publishes from the designated Windows machine; collaborators do not need webhook credentials or local Discord tracking files. A merge, build or deployment does not itself authorize a Discord post.

### Shared work process

Everyone, including coding assistants, works from [docs/backlog.json](docs/backlog.json) on current `main`. GitHub issues hold discussion and acceptance criteria; PRs hold proposed implementation. Neither creates a separate priority or status list. Old lane labels such as B10 describe earlier work briefs, not canonical backlog IDs.

1. **Find the item before coding.** Sync current `main`, read the backlog and roadmap decisions, and identify the permanent ID (for example `RAID-010`). Search existing issues and open PRs for that outcome, not just its title. Check prerequisites and shared-file coordination.
2. **Reconcile gaps first.** If an issue has no backlog item, propose the mapping or a new item to the maintainer before implementation. Check current `main` and open PRs before allocating an ID. Do not force unrelated scope into an existing item, resurrect released work without explaining the new scope, or implement directly from an old list. Documentation/tooling-only maintenance can state `Backlog: N/A` with a reason; this is not an exemption for untracked application features or fixes.
3. **Claim the work visibly.** Comment on the linked issue with the backlog ID, owner, intended scope and branch/PR when available. If there is no issue, open one using the work-item template. Confirm no other collaborator is already doing it; coordinate overlapping work before coding. Include `in-progress` and the claim/issue reference in the backlog update proposed with the work. Agree priority, dates and scope changes with the maintainer rather than changing them silently.
4. **Keep the links together.** Use `Backlog: RAID-010` in the issue and PR body; use multiple IDs only when the change genuinely covers them. Link the GitHub issue from the PR and record its reference in the backlog item's `notes`. Add the PR number to `prs` once known. Do not add undeclared fields to the backlog schema. For example, `RAID-010` maps to issue #95 (old B10) and implementation PR #110.
5. **Submit the whole delivery record.** Use the PR template. Include acceptance results, remaining scope, backlog status/PR references and a member-facing Unreleased bullet when applicable. Partial delivery keeps the item open with explicit remaining work. Only use `Closes #...` when the issue's required scope is fully satisfied; optional follow-ups must be identified, not falsely checked off.
6. **Separate merge from release.** Implementation in an open PR is `in-progress`; merged but unverified application work is `awaiting-deployment`. The primary maintainer records `released` only after production verification, with the exact dated changelog heading. Update these transitions in the merge/release follow-up if they cannot be recorded in the implementation PR. A closed GitHub issue can mean implementation merged, not production availability; its discussion should make the distinction clear.
7. **Reconcile existing issues with evidence.** Link each issue to a backlog item or explain why it is a duplicate, superseded or no longer needed. Before proposing closure as resolved, check required acceptance criteria against merged code, validation and deployment evidence where required. Record the evidence and any remaining work. Do not bulk-close from titles, checked boxes or a PR reference alone; ask the maintainer when scope or resolution is uncertain.

Use the [GitHub work-item template](.github/ISSUE_TEMPLATE/work-item.md) and [PR checklist](.github/pull_request_template.md). Templates and assistant instructions are guidance, not an enforced gate: the contributor and reviewer must check the mapping and delivery record. Existing issues are not automatically migrated. After this process is merged, collaborators should pull current `main` and have their coding assistants reread `AGENTS.md` before starting the next task.

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
