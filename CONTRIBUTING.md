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

Then click through every tab as each role (use VIEW AS as a Guild Leader to preview Raid Leader and Member), open each dialog you touched, and make sure the browser console is clean. There are no automated tests yet, so say in the PR what you checked.

## Pull requests

- Keep them small and about one thing. A refactor and a feature are separate PRs.
- Work in your feature's folder under `src/features/`. If you must change a shared file, do it in its own commit and call it out in the PR description. Shared files are: `src/shared/**`, `src/shell/**`, `src/App.tsx`, `src/App.css`, `src/guildApi.ts`, `src/useGuildData.ts`, `src/useGuildSession.ts`, `src/security.ts`, `firestore.rules`, `firebase.json`, `package.json`, `package-lock.json`, `.nvmrc` and everything under `.github/`.
- A change that adds or changes a Firestore collection or a rule needs the rules change in the same PR, reviewed on its own, and a note about deploy order: rules first, then hosting.
- Deploy only when you are asked to. Hosting and rules are deployed separately, so a rules change must be deployed before the hosting build that depends on it.
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
