# Intrepid Guild Raid Desk: instructions for coding assistants

A React + TypeScript + Vite guild-operations app on Firebase Authentication and Cloud Firestore. Read `ARCHITECTURE.md` before adding a feature and `CONTRIBUTING.md` for the contribution rules.

## Commands

- `npm run build` and `npm run lint` must both pass. There are no automated tests yet, so check the app by hand in your own Firebase project (see `CONTRIBUTING.md`).
- Deploy to Firebase only when you are asked to.

## Rules that must not be broken

- Firestore security rules are the authorization boundary. UI role checks only hide controls, and the VIEW AS preview must never reach a data hook or a write helper.
- Award snapshots (the candidate order and council note at decision time) are immutable. Awards and raids cannot be updated or deleted from the client.
- Do not imply that local browser data is shared. Only authenticated Firestore data is.
- This repository is public. Never put real character names, account emails, keys or service-account files in code, fixtures, tests or screenshots; use invented names.

## Layout

- `src/shell/` is the frame (sidebar, top bar, dialog host, and the tab registry in `tabs.ts`). `src/shared/` holds what features share. `src/features/<name>/` holds one feature each.
- A feature is a `tab.tsx` exporting a `TabDefinition` (written `as const satisfies TabDefinition`, never annotated), a content component, and any dialogs. Register it with one import and one line in `src/shell/tabs.ts`. Do not add feature code to `src/App.tsx`.
- Imports go one way: `core and shared <- features <- shell <- App`. A feature never imports another feature or the shell; shared never imports a feature or the shell.
- Dialogs open with `ctx.openModal(({ close, live }) => <Dialog close={close} live={live} />)`. Read `busy` and anything else that changes from `live`, never from the `ctx` you opened it with.

## Shared files

Changes to these need their own commit and a note in the PR: `src/shared/**`, `src/shell/**`, `src/App.tsx`, `src/App.css`, `src/guildApi.ts`, `src/useGuildData.ts`, `src/useGuildSession.ts`, `src/security.ts`, `firestore.rules`, `firebase.json`, `package.json`, `package-lock.json`. Keep `./App.css` as the last import in `App.tsx`.

## Vocabulary

The code calls unavailable dates "AFK" (`afkEntries`, `AfkCalendar`, the tab id `afk`). Keep those names; the interface says "Raid Calendar" and "unavailable dates".

## Do not

- Reformat code you are not changing, or add dependencies without saying why.
- Add wrapper elements or reorder children inside existing components: `App.css` relies on `:nth-child` positions.
