# Roadmap, decisions and work lanes

Last updated 2026-10-15. This file records what the guild leaders decided, what is being built, and who can work on what in parallel. It does not replace the "Discussed future work" list in the README; it turns it into an order of work. Keep it short and update it when a decision changes.

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
| Leavers | Runbook now (unlink the character, set role Member, disable the Auth user in the Firebase console, do not delete the member doc first). A one-click "Removed" status in Member Access is built before launch. |
| Loot input | Paste an RCLootCouncil-format export (CSV) with a preview before anything is saved, plus manual entry. The format stays addon-agnostic because the guild may write its own addon. Item names and icons from Wowhead's unofficial tooltip endpoint are optional; manual entry must work without it. Warcraft Logs waits until it supports Forever. |
| Positional priority and filters | A player listed twice for an item: the first receipt satisfies the first listing, the second the second. Filters: slot, boss, only items with a priority, hide completed, player and class. Both are important. |
| Roles | **Guardian** is a Druid spec (feral tank, defaults to Tank) and **Feral** defaults to Melee. Done. A Guild Leader can set any character's role; the spec only supplies the default (done). Survival Hunter keeps Ranged as its default. |
| Alts | The roster holds one entry per character. An alt can be linked to a main (done: optional `mainId` on the roster entry, set in the Edit member dialog; the loot and attendance rules below are not built yet). For loot, alts are considered only after all mains, except in a run made up only of alts in 10 or 20 player content (to be recorded per raid). Attendance is per player, so linked alts roll up to the main. |
| Attendance | Rolling 3 months. Members see their own percentage, leaders see everyone's. Voluntary and involuntary benches are recorded as different things. Open: how each counts (see Open questions). |
| Discord | Raids are managed in the app; Discord is where people sign up and get notified. The app connects directly to a guild-owned Discord bot through Cloud Functions, with no third-party raid tool. See Discord sign-ups under Later. |
| License | MIT for the code only. Crest and interface artwork were generated with ChatGPT; spec icons are Blizzard artwork from danetch/wowspecsemojis and stay non-commercial. |
| Readability | One CSS pass that raises small text sizes and contrast, after the leaders have seen screenshots. |
| Hosting plan | Move Firebase to Blaze with a small budget alert (the free plan allows 50,000 reads a day). |
| Process | Node 24. Pull requests are merged with a merge commit. Rules changes come with rules tests. |

## Open questions

- **Bench counting.** Both kinds of bench were chosen to count as absence, and the two kinds must be told apart. Confirm whether an involuntary bench (the leader asked someone to sit) should also count against that player, or only be recorded.
- **Alt-only runs.** The exception to "mains first" needs a per-raid flag; confirm the wording and where it is set when raids become editable.

## Work lanes

The point of the module layout (see `ARCHITECTURE.md`) is that several people can work at once. Lane A touches Firestore rules and shared files and is sequenced carefully; lane B is client-only feature work that does not wait for it.

### Order of work

- **Before launch (11-04):** roster and organization: Guardian spec, editable role and alt link (done); the raid coverage checklist; the Removed status for leavers (item 7); raid edit and cancel (item 6).
- **Before the first raids (12-09):** loot: audit-first loot (item 3), then roster-picked candidates (item 4), positional priority and filters, and loot import.

### Lane A: foundation (rules, data model, shared files)

In this order, each as its own small pull request:

1. Rules tests and a CI job for them, tolerant reads and error boundaries, access-screen fixes, the dark-theme fix (pull requests being sent for review).
2. Fix: approving a join request must not overwrite an existing member (found by the rules tests; done in the join-request overwrite fix).
3. Audit-first loot: audit log collection and rules, who and when on every award, leader-editable awards and priorities, retire the local-preview import and the Guild Leader award exception. This replaces the "awards are immutable" rule in `AGENTS.md`, `README.md`, `ARCHITECTURE.md` and `.github/copilot-instructions.md`; those are updated in the same pull request, not before.
4. Pick candidates from the roster (stable roster ids) instead of typing names.
5. Phase, status, council status and team-name settings (10-, 20- and 40-player teams) (replaces the hardcoded "Launch prep" and "Preparing for launch"). Done: `settings/general`, the Guild Leader Settings tab and its rules tests.
6. Raid edit, cancel and correction, with audit entries.
7. "Removed" status for leavers, with a no-access screen.

Lane A files: `firestore.rules`, `firebase.json`, `src/guildApi.ts`, `src/useGuildData.ts`, `src/useGuildSession.ts`, `src/features/loot/**` for the award and priority write paths.

### Lane B: feature modules (client-only, can start now)

Each is one feature folder plus the one-line registry or wiring change described in `ARCHITECTURE.md`. None needs a rules change or a deploy.

- **Raid coverage checklist** (very important): a panel showing which buffs and debuffs a 10, 20 or 40 player team covers and what is missing. A design exists; ask for it. All game facts live in one editable data file with a source and confidence for each entry.
- **Positional priority completion and loot filters**, in `src/features/loot/`. These read priorities and awards; they do not change how awards are written.
- **Guardian spec, editable role and alt link (all done)** in `src/features/roster/` and `src/shared/game/classes.ts`. The alt link is an optional field on the roster entry (roster rules do not validate fields, so no rules change).

### Later, after the foundation

- Loot import (CSV paste with preview, manual entry): needs the new award shape and roster ids.
- Attendance: needs raid edit and cancel, roster ids and the alt link.
- Readability pass: after screenshots are approved.
- **Discord sign-ups and notifications.** Not started; needs raid edit and cancel (item 6) first. In order:
  1. A Discord user ID on members, set by a Guild Leader in Member Access, so a sign-up maps to a roster character and its main.
  2. Announcements through a channel webhook (a Cloud Function) when a raid is scheduled, changed or cancelled. One-way.
  3. Sign-up buttons (Accept, Tentative, Decline, and a role or spec choice) on a bot-posted message. Discord calls an HTTPS interactions endpoint (a Cloud Function) that verifies Discord's request signature, writes the sign-up to a `signups` subcollection of the raid, and edits the message to show the current roster. Members can read sign-ups but cannot write them; only the function does, so the Firestore rules stay the authorization boundary.
  4. Reminders (for example 24 hours and 1 hour before a raid) to people who have not answered, from a scheduled function; attendance rolls up to the main.
  - Needs: the Blaze plan (already planned) for Cloud Functions and Cloud Scheduler; the bot token, the Discord public key and any webhook URL kept in function secrets, never in the repo or the client (the repo is public); a Discord server admin to create the application and invite the bot with narrow permissions (post and edit messages in one channel); server-side role checks in each function.
  - Open: whether sign-ups made in the app should also update the Discord message (two-way), and how a sign-up counts toward the coverage checklist.

## How to avoid stepping on each other

- Changes to the shared files listed in `AGENTS.md` get their own commit and a note in the pull request.
- If you touch `firestore.rules`, add or update the matching test in `tests/rules/` and run `npm run test:rules`.
- One format-everything commit is deferred: it conflicts with every open branch, so it only makes sense when no branch is open.
- Say in the pull request which lane an item belongs to, so two people do not start the same thing.
