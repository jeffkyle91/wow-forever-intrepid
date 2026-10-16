# Contributing

Thanks for helping. This is a guild tool with real data in production, so the rules are about keeping that safe and keeping changes easy to review. Read `ARCHITECTURE.md` for how the code is laid out.

## Set up

Use the Node.js version given in the README.

```bash
npm install
cp .env.example .env.local   # then fill in your own Firebase values
npm run dev
```

Use your **own** Firebase project for development: a free (Spark) project with Email/Password sign-in, a Firestore database in production mode, the rules from `firestore.rules`, and your own `VITE_GUILD_ID`. Follow "Firebase project setup" in the README. Never point `.env.local` at the production project, and never commit `.env.local`.

Awards and raids cannot be deleted from the app (unavailable dates can only be removed by their owner), so test on your own project and not on the live guild.

## Before you open a pull request

```bash
npm run build
npm run lint
```

If you changed `firestore.rules`, also run `npm run test:rules` (see "Testing the Firestore rules" below).

Then click through every tab as each role (use VIEW AS as a Guild Leader to preview Raid Leader and Member), open each dialog you touched, and make sure the browser console is clean. The only automated tests cover the Firestore rules, so say in the PR what you checked in the app.

## Testing the Firestore rules

The rules are the authorization boundary, so they have tests that run against the local Firestore emulator. You need a JDK, version 21 or newer, because the emulator is a Java program (check with `java -version`; Temurin from adoptium.net is fine, or `brew install openjdk@21` on macOS, which also needs adding to your `PATH`). Then:

```bash
npm run test:rules
```

It takes under a minute and needs no Firebase login, no Firebase project and no `.env.local`: it uses the demo project `demo-intrepid`, and the tests talk only to the emulator on `127.0.0.1`. The script runs `firebase-tools` through a version-pinned `npx` call (it is deliberately not a dependency of this repo, with install scripts turned off), and the first run downloads the emulator jar (about 137 MB) into your user cache. The emulator port is in `firebase.json` (`emulators.firestore.port`); change it there if it clashes with something on your machine.

The tests are in `tests/rules/`, written in TypeScript and run by Node's built-in test runner. `access-matrix.test.ts` lists, per collection, which role may get, list, create, update and delete; the other files cover the rules that depend on the data (join requests, the account-to-character link, award snapshots, availability, raid zones and raids, and how large a batch can be). A comment above each group says who may do what.

- Change a rule and its tests in the same pull request. Add a case for every new branch, and for the thing it must still refuse.
- Tests named "KNOWN GAP" record what the rules do today even though it is arguably wrong or weak. They are not approvals. When a rules change closes a gap, that test fails: flip it to expect a refusal and remove the label.
- `tests/rules/support/client.ts` repeats the multi-document batches from `src/guildApi.ts`. If you change how `approveJoinRequest` or `updateMembershipAccess` build their batches, change the copy too.
- Use invented names and uids in tests, as everywhere else in this repository.
- `npm run build` does not compile the tests and `npm run lint` only lints them; `npx tsc -p tests/rules` type-checks them (CI does not run that).

## Pull requests

- Keep them small and about one thing. A refactor and a feature are separate PRs.
- Work in your feature's folder under `src/features/`. If you must change a shared file, do it in its own commit and call it out in the PR description. Shared files are: `src/shared/**`, `src/shell/**`, `src/App.tsx`, `src/App.css`, `src/guildApi.ts`, `src/useGuildData.ts`, `src/useGuildSession.ts`, `src/security.ts`, `firestore.rules`, `firebase.json`, `package.json`, `package-lock.json`, `.nvmrc` and everything under `.github/`.
- A change that adds or changes a Firestore collection or a rule needs the rules change in the same PR, reviewed on its own, tests for it in `tests/rules/`, and a note about deploy order: rules first, then hosting.
- Deploy only when you are asked to. Hosting and rules are deployed separately, so a rules change must be deployed before the hosting build that depends on it.
- Opening a PR: `gh pr create --fill` (GitHub CLI). The merge is done in GitHub.
- After the merge, a maintainer asks for the deploy. `npm run release` from a clean `main` that matches `origin/main` runs the read-only checks and prints the plan (and refuses if the build would use a Firebase project other than the live one). `npm run release -- --deploy` then builds, lints, runs the rules tests, deploys the Firestore rules (the CLI skips them if unchanged), then hosting, then moves the `last-deploy` note. Any other argument is an error, so `--help` and typos cannot deploy.
- Match the existing style. There is no formatter yet, so do not reformat code you are not changing; it makes the diff unreadable.

## Rules that protect the guild

- Firestore security rules are the authorization boundary. UI role checks only hide controls.
- The VIEW AS preview only changes what the UI shows. Do not pass a previewed role to data hooks or write helpers.
- Award snapshots (candidate order and council note at decision time) are immutable. Do not alter how they are built or stored without discussing it first.
- Do not imply that local browser data is shared. Only authenticated Firestore data is.
- This repository is public. Do not commit real character names, account emails, Firebase service-account files or keys, or anything from a private guild spreadsheet or tracker. Use invented names in examples and tests.
- The class and specialization icons are Blizzard artwork used under the fan-content note in the README. Do not add other Blizzard assets.

## Using an AI assistant

Assistants such as Copilot and Claude Code work well here if they read `ARCHITECTURE.md` first. Point them at it, keep them inside one feature folder, and review what they change in shared files line by line. Do not let one reformat `src/App.tsx`.
