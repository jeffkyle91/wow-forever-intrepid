# Design: the one-time launch reset (OPS-005)

Status: built and rehearsed on the local emulator with invented data; not run on any real project. The maintainer runs it, once, on launch day.

## Why

Everything recorded in the pre-launch phase ("Launch prep") was beta and testing: awards, loot priorities and the Log entries about them. None of it should count, appear on a member's dashboard or sit in the permanent record once the first real phase starts. The guild's loot owner asked for it to be erased once, at launch, and for the Log to be immutable from then on.

The app cannot do this, by design: the rules never allow an award or a Log entry to be deleted (`allow delete: if false`), and `AGENTS.md` lists that as a rule that must not be broken. So the erase is not an app feature. It is a script the maintainer runs once with the Admin SDK (which the rules do not apply to), and every step of it is a check that it only erases what was agreed. After it, the rules are exactly what they were: nothing in the app can delete an award or an entry.

Why a script and not a button backed by a Cloud Function: a deployed delete path stays in production for as long as the project lives, where one mistaken or hijacked leader click could erase real loot. A script leaves nothing behind.

## What it erases, and what it keeps

For one finished phase (the first, "Launch prep", unless told otherwise):

| Erased | Kept |
| --- | --- |
| The awards of that phase (an award with no `phaseNo` is in the first phase) | The awards of every later phase |
| The loot priorities of that phase | The priorities of every later phase (a carried-over copy is a priority of its own) |
| The Log entries about those awards and priorities, including the entries of a priority that was deleted (its phase is read from its create or delete entry) | Every other Log entry: phase starts and reopens, drop list changes, raid entries, and the entries of later phases |
| | The drop lists (`lootTables`; a later phase can follow them), the settings, the phase's name in `phaseHistory` (the number of every later phase is that list's length), the roster, raids and members |

An entry about something whose phase cannot be told is kept and reported, never guessed.

## The safeguards

1. **Dry run by default.** Without `--apply` nothing is changed. It prints what would be erased, with examples, and what would be kept.
2. **Two keys.** To erase, the dry run's three numbers (awards, priorities, entries) are passed back with `--expect-*`, the project id is repeated with `--confirm-project`, and the phase is named with `--phase-name`. The plan is made again at that moment and must be exactly the confirmed numbers: loot recorded in the phase after the dry run stops the reset instead of being erased unseen.
3. **Typed confirmation.** The last step is typing `ERASE <phase name>` in a terminal. It will not run without a terminal.
4. **Only a finished phase.** It refuses while the phase is the guild's current one (the first real phase must have started) and when the phase is not called what `--phase-name` says.
5. **Backup first.** Everything to be erased is written to one file (owner-only permissions), under a temporary name, read back and counted, and only then moved into place, before the first delete. The file must be an absolute path outside the repository (it holds real names), and an existing file is never overwritten.
6. **A guard before every delete.** Every award and priority in the erase list must be of the phase.
7. **Checked afterwards, then sealed.** After the deletes the plan is made again; if anything of the phase is left, or an entry is left whose phase cannot be told, the guild is not sealed and nothing is recorded. Only then are the seal (`settings/launchReset`) and the Log record (`auditLog/ledger_launch-reset_1`) written, with `create()` so neither can be written twice.
8. **Once.** With the seal there, the script refuses to run again. The seal and the record cannot be written, changed or deleted through the app (`tests/rules/launch-reset.test.ts`). The owner of the Firebase project can still change anything in the console; the rules cannot prevent that, and the script's once-only check is the script's, not the database's.
9. **The record is visible.** The Log shows one entry, "Erased the test data of 'Launch prep', once, for good", with the numbers. It is the only trace of the erased data in the Log.

The deletes are in batches and are not atomic as a whole, so a run can stop part way (a lost connection, a closed laptop). Two things keep that safe:

- **The order.** The Log entries that say which phase something is of (the create and delete entries) go after the others, and the awards and priorities go last, so whatever is left can still be attributed to the phase.
- **`--resume`.** Nothing is sealed after a stop. Run the dry run with `--resume --backup <the same file>`: it reads the backup (which says which phase the entries of an award or priority that is already gone belong to) and shows what is left. Then apply with `--resume`, the same backup file and the new numbers. The backup is not written a second time, anything of the phase that is not in it stops the run (loot recorded since), and the seal and the Log record count the whole reset from the backup, not only the last run's share. The same path finishes the seal when the erase was done and only the seal and the record failed (the numbers are then 0, 0, 0).

## Launch-day runbook

1. Rehearse beforehand against a test project or the emulator with invented data (`npm run test:rules` runs the tests; the script itself runs against the emulator when `FIRESTORE_EMULATOR_HOST` is set).
2. Start the first real phase in Settings (typed confirmation). Wait until you are sure it will not be reopened: reopening is possible only until something is awarded in it, and a reopened "Launch prep" would be empty.
3. Make sure no leader is recording loot. Take a full Firestore export to a private bucket first (required, not optional: the script's own backup holds only what it erases, and there is no restore script), and note where it is next to the backup file. Confirm Firestore point-in-time recovery is on if the project has it.
4. Dry run, and read it:

   ```
   node scripts/launch-reset.mjs --project <project id> --guild <guild id> --phase-name "Launch prep"
   ```

5. Erase, with the numbers it printed (if it stops part way, see `--resume` above):

   ```
   node scripts/launch-reset.mjs --project <project id> --guild <guild id> --phase-name "Launch prep" --apply \
     --confirm-project <project id> --backup /absolute/path/outside/the/repo/launch-prep-backup.json \
     --expect-awards N --expect-priorities N --expect-entries N
   ```

6. Open the Log: the record is there, nothing of "Launch prep" remains, and the later phases are untouched. Keep the backup file private.

The credentials are the maintainer's own (`gcloud auth application-default login` or `GOOGLE_APPLICATION_CREDENTIALS`). The script reads every award, loot priority and Log entry of the guild once, and again after the deletes (one read each; the free allowance is 50,000 reads a day).

## What this does not do

- It does not restore anything. The backup is plain JSON of the erased documents (timestamps as `{ "__timestamp": ISO }`); a restore script was not written because the reset is meant to be final.
- It does not stop a reopen of the erased phase afterwards (the app would show it empty).
- It does not touch awards in the phase that is current.

## Where it lives

`functions/launchReset.js` (the plan, the checks and the erase, tested on the emulator by `functions/launchReset.test.js`, which `npm run test:rules` runs), `scripts/launch-reset.mjs` (the command line), the Log's wording in `features/loot/auditText.ts`.
