# Roadmap, decisions and work lanes

Last updated 2026-10-16. This file records what the guild leaders decided, what is being built, and who can work on what in parallel. It does not replace the "Discussed future work" list in the README; it turns it into an order of work. Keep it short and update it when a decision changes.

## Dates that drive the order

- **2026-11-04** WoW: Forever launch. Loot is not recorded at launch, so the app needs the roster, raid teams and calendar working, not loot.
- **2026-12-09** the first raids unlock (Barrow Deeps 10, Hyjal Summit 20, Onyxia 40). Recording loot (and correcting it) must work by then.
- **About 2026-10-21 and 22** the beta ends. Game data in the app (buffs, debuffs, scopes) must be re-checked then, in launch week, and on 12-09.

## Decisions

| Topic | Decision |
| --- | --- |
| Loot is editable | Guild Leaders and Raid Leaders can edit awards and priorities after the fact (people swap gear without telling officers). Every change is recorded in an append-only audit log (who, when, before and after, optional reason) that nobody can edit or delete from the app. The as-awarded snapshot (candidate order and council note at decision time) stays frozen inside each award. Awards are never deleted: "removing" one is an edit that marks it removed, with a reason. |
| Audit log visibility | Every guild member can read it. |
| Rules must enforce it | The audit entry is written in the same atomic batch as the change and the rules require it, so a modified browser cannot skip it. Rules tests (`npm run test:rules`) come with the change. |
| Old local-preview import | Never used. Delete the "Import local data" feature and the Guild Leader exception in the award rule, so there is one validated way to create an award. |
| Raids | Leaders can edit and cancel upcoming raids and correct the details of past ones (for example who actually showed up). Raids are never hard-deleted, and every change is audited. |
| Raid teams and scheduled raids | One scheduled raid night can include multiple zones, each with its own 10-, 20-, or 40-player size. The corresponding groups are included automatically: all four 10-player teams, both 20-player groups, or the single 40-player group. Assignments are live until the scheduled start time. A server-side job automatically locks a snapshot of assigned teams and sign-ups at the start; later changes to the Raid Teams tool do not change that raid. Guild and Raid Leaders may make audited changes to the locked raid team while it is in progress. Attendance is recorded against the raid snapshot. |
| Sign-up character | Members choose their linked main (the default) or a direct alt for each raid. One response per account: Accept, Tentative, Absent, Late, Bench (voluntary). Authenticated server callables enforce the start cutoff, cancellation and unavailable dates; direct writes are denied by Firestore rules. An overlapping unavailable event sets Absent and locks changes until all covering events are removed. Removing events retains Absent until the member explicitly chooses a new response. Leader benching and capacity decisions come later. The selected character uses its current Raid Teams assignment; the live preview is not a starting snapshot. |
| Raid zones | Leaders maintain the zone catalog and each zone's 10-, 20-, or 40-player size in Settings. They select one or more zones when scheduling a raid night; each selected zone snapshots its name and size so later catalog edits do not rewrite scheduled raids. |
| Raid notifications | Send reminders when a raid is created, 24 hours before, and 1 hour before. Delivery channel and server implementation are to be decided; scheduled server work is required for reliable timing and automatic roster locking. |
| Leavers | Runbook now (unlink the character, set role Member, disable the Auth user in the Firebase console, do not delete the member doc first). A one-click "Removed" status in Member Access is built before launch. |
| Loot input | Paste an RCLootCouncil-format export (CSV) with a preview before anything is saved, plus manual entry. The format stays addon-agnostic because the guild may write its own addon. Item names and icons from Wowhead's unofficial tooltip endpoint are optional; manual entry must work without it. Warcraft Logs waits until it supports Forever. |
| Positional priority and filters | A player listed twice for an item: the first receipt satisfies the first listing, the second the second. Filters: slot, boss, only items with a priority, hide completed, player and class. Both are important. |
| Roles | **Guardian** is a Druid spec (feral tank, defaults to Tank) and **Feral** defaults to Melee. Done. A Guild Leader can set any character's role; the spec only supplies the default (done). Survival Hunter keeps Ranged as its default. |
| Alts | The roster holds one entry per character. An alt can be linked to a main (done: optional `mainId` on the roster entry, set in the Edit member dialog; the loot and attendance rules below are not built yet). For loot, alts are considered only after all mains, except in a run made up only of alts in 10 or 20 player content (to be recorded per raid). Attendance is per player, so linked alts roll up to the main. |
| Attendance | Rolling 3 months. Members see their own percentage, leaders see everyone's. Voluntary and involuntary benches are recorded as different things. Open: how each counts (see Open questions). |
| Discord | Raids are managed in the app; Discord is where people sign up and get notified. The app connects directly to a guild-owned Discord bot through Cloud Functions, with no third-party raid tool. See Discord sign-ups under Later. |
| Member dashboard | A landing tab for signed-in members who have a linked character. It shows their characters (main and alts), raid sign-ups, raid team, loot priorities, loot and upcoming raids, in that order of importance. Members without a linked character still see the app and the tools they see today. Access stays guild members only; nothing is opened to the public. Leaders get extra Management tabs in the same app, not a separate dashboard, and can see what members see. See Member dashboard under Later. |
| License | MIT for the code only. Crest and interface artwork were generated with ChatGPT; spec icons are Blizzard artwork from danetch/wowspecsemojis and stay non-commercial. |
| Readability | One CSS pass that raises small text sizes and contrast, after the leaders have seen screenshots. |
| Hosting plan | Move Firebase to Blaze with a small budget alert (the free plan allows 50,000 reads a day). |
| Process | Node 24. Pull requests are merged with a merge commit. Rules changes come with rules tests. |

## Open questions

- **Bench counting.** Both kinds of bench were chosen to count as absence, and the two kinds must be told apart. Confirm whether an involuntary bench (the leader asked someone to sit) should also count against that player, or only be recorded.
- **Alt-only runs.** The exception to "mains first" needs a per-raid flag; confirm the wording and where it is set when raid sign-ups are built.

## Work lanes

The point of the module layout (see `ARCHITECTURE.md`) is that several people can work at once. Lane A touches Firestore rules and shared files and is sequenced carefully; lane B is client-only feature work that does not wait for it.

### Order of work

- **Before launch (11-04):** roster and organization: Guardian spec, editable role and alt link (done); the raid coverage checklist; the Removed status for leavers (item 7); raid edit and cancel (item 6, done).
- **Before the first raids (12-09):** complete the raid lifecycle work below and the loot flow: audit-first loot (item 3), roster-picked candidates (item 4), positional priority and filters, and loot import.

### Lane A: foundation (rules, data model, shared files)

In this order, each as its own small pull request:

1. Rules tests and a CI job for them, tolerant reads and error boundaries, access-screen fixes, the dark-theme fix (pull requests being sent for review).
2. Fix: approving a join request must not overwrite an existing member (found by the rules tests; done in the join-request overwrite fix).
3. Audit-first loot: audit log collection and rules, who and when on every award, leader-editable awards and priorities, retire the local-preview import and the Guild Leader award exception. This replaces the "awards are immutable" rule in `AGENTS.md`, `README.md`, `ARCHITECTURE.md` and `.github/copilot-instructions.md`; those are updated in the same pull request, not before.
4. Pick candidates from the roster (stable roster ids) instead of typing names.
5. Phase, status, council status and team-name settings (10-, 20- and 40-player teams) (replaces the hardcoded "Launch prep" and "Preparing for launch"). Done: `settings/general`, the Guild Leader Settings tab and its rules tests.
6. Raid edit, cancel and correction, with audit entries. Done: leaders click a raid on the calendar to edit, cancel (reason required, raid stays visible as Cancelled) or restore it; the rules require a `raid_{id}_{rev}` audit entry in the same batch; tests in `tests/rules/raid-edits.test.ts`. Not built yet: a screen to read the audit log.
7. "Removed" status for leavers, with a no-access screen.

Lane A files: `firestore.rules`, `firebase.json`, `src/guildApi.ts`, `src/useGuildData.ts`, `src/useGuildSession.ts`, `src/features/loot/**` for the award and priority write paths.

### Lane B: feature modules (client-only, can start now)

Each is one feature folder plus the one-line registry or wiring change described in `ARCHITECTURE.md`. None needs a rules change or a deploy.

- **Raid coverage checklist** (very important): a panel showing which buffs and debuffs a 10, 20 or 40 player team covers and what is missing. A design exists; ask for it. All game facts live in one editable data file with a source and confidence for each entry.
- **Positional priority completion and loot filters**, in `src/features/loot/`. These read priorities and awards; they do not change how awards are written.
- **Guardian spec, editable role and alt link (all done)** in `src/features/roster/` and `src/shared/game/classes.ts`. The alt link is an optional field on the roster entry (roster rules do not validate fields, so no rules change).

### Later, after the foundation

- Loot import (CSV paste with preview, manual entry): needs the new award shape and roster ids.
- **Raid lifecycle (before first raids, 12-09):** The Guild Leader-managed zone catalog, multi-zone scheduling, member sign-ups and live team preview are implemented. Each scheduled raid snapshots its zone names and sizes. Sign-ups close at the stored start instant (or cancellation); older raids need a leader to save their details once to initialize that instant. Assignments are still live, even after start, and the preview says so. Next, server-side work will save the immutable starting roster and sign-ups so later Raid Teams changes cannot rewrite that snapshot. Guild and Raid Leaders may then make audited team changes during the raid. Add leader benching, reminders at raid creation, 24 hours before and 1 hour before, then attendance against the locked snapshot.
- Attendance: needs raid edit and cancel (done), roster ids, the alt link, and the raid-start snapshot.
- Readability pass: after screenshots are approved.
- **Member dashboard.** Stage 1 and the sign-up/live-preview slice of stage 3 are built (landing tab in `src/features/dashboard/`). Remaining work:
  1. Done: read-only landing tab for members with a linked character: characters (main and alts), upcoming raids, raid team, loot priorities and awards. Client-only; reads existing data, no rules change. Members without a linked character get a short "ask a Guild Leader to link your character" note and keep the normal tabs.
     Also done: upcoming absences with an Add absence button (reuses the calendar's `afkEntries`), and a Comments section with Public and Leadership notes (rules `publicComments` and `leaderComments`, tests in `tests/rules/comments.test.ts`). Raider type (Casual or Hardcore, `raiderTypes`, tests in `tests/rules/raider-types.test.ts`) and the attendance placeholder sit in the header. Not built yet: using raider type for raid-spot priority, and showing other people's comments, for example on the roster or a leader Management tab.
  2. Self-service character changes, with rules and tests: a member can request a new alt and change spec and role on their own linked characters, but never the name. A change of class or spec is a request that a Guild Leader approves; whether a role-only change also needs approval is open. Members cannot put themselves on a team.
  3. Done: raid sign-ups from the dashboard and calendar, using `raids/<raidId>/signups/<uid>` with rules tests in `tests/rules/raid-signups.test.ts` and server tests in `functions/raids.test.js`. Members choose their main or a direct alt; buttons immediately save Accept, Tentative, Absent, Late or Bench (voluntary), with colors on hover/selection. Server callables enforce ownership, the start-time cutoff and unavailable dates; Firestore denies direct writes. Overlapping unavailable dates force Absent, lock response controls and hide the preview. Removing every overlapping event leaves Absent until a new response is chosen. Triggers synchronize new/rescheduled raids and newly linked mains; Settings provides a Guild Leader-only initial backfill. This introduces Functions/Blaze setup, not the scheduled reminders or locking below. A separate preview is available only after saving Accept, Tentative or Late and shows only the saved character's live 10-player team, regardless of zone size. An unassigned alt does not inherit its main's team. Not built: leader benching, automatic capacity decisions and the immutable starting snapshot.
  4. Server-side reminders at raid creation, 24 hours before, and 1 hour before; automatic roster lock and immutable starting snapshot at the scheduled start. A leader can make audited team changes during the raid without changing the start snapshot.
  5. Attendance percentage and unavailable dates on the dashboard, recorded against the locked roster; reminder delivery is part of the server-side raid work above.
  - Leader Management tabs (for example access requests, pending change requests, raids missing sign-ups, coverage gaps) are added to the same app for the Guild Leader role.
  - Open: whether a role-only change needs approval; whether over-capacity benching is automatic (first come first served) or always a leader decision; how a self-bench counts for attendance (see Open questions).
- **Discord sign-ups and notifications.** Not started; needs raid edit and cancel (item 6, done) first. Discord is a possible delivery channel, but the reminder channel is not yet decided. In order:
  1. A Discord user ID on members, set by a Guild Leader in Member Access, so a sign-up maps to a roster character and its main.
  2. Announcements through a channel webhook (a Cloud Function) when a raid is scheduled, changed or cancelled. One-way.
  3. Sign-up buttons on a bot-posted message, mapped to the app's existing response states and character choices. Discord calls an HTTPS interactions endpoint (a Cloud Function) that verifies Discord's request signature and the member's identity, character ownership and start-time cutoff, writes the same `raids/<raidId>/signups/<uid>` document, and updates the message. The app already lets members write only their own response through Firestore rules; server functions must enforce equivalent checks because Admin SDK writes bypass those rules.
  4. Reminders at raid creation, 24 hours before and 1 hour before, from scheduled server work; attendance rolls up to the main.
  - Needs: the Blaze plan (already planned) for Cloud Functions and Cloud Scheduler; the bot token, the Discord public key and any webhook URL kept in function secrets, never in the repo or the client (the repo is public); a Discord server admin to create the application and invite the bot with narrow permissions (post and edit messages in one channel); server-side role checks in each function.
  - Open: whether sign-ups made in the app should also update the Discord message (two-way), and how a sign-up counts toward the coverage checklist.

## How to avoid stepping on each other

- Changes to the shared files listed in `AGENTS.md` get their own commit and a note in the pull request.
- If you touch `firestore.rules`, add or update the matching test in `tests/rules/` and run `npm run test:rules`.
- One format-everything commit is deferred: it conflicts with every open branch, so it only makes sense when no branch is open.
- Say in the pull request which lane an item belongs to, so two people do not start the same thing.
