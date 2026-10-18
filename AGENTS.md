# Intrepid Guild Raid Desk: instructions for coding assistants

A React + TypeScript + Vite guild-operations app on Firebase Authentication and Cloud Firestore. Read `ARCHITECTURE.md` before adding a feature and `CONTRIBUTING.md` for the contribution rules. `docs/ROADMAP.md` records the decisions, the order of work and who can work on what in parallel.

## Before starting work

- Read the current [canonical backlog](docs/backlog.json) and follow the [shared work process](CONTRIBUTING.md#shared-work-process). Identify the backlog ID, check linked GitHub issues and open PRs, and coordinate a claim before implementation.
- GitHub issue numbers, old lane labels (such as B10), Discord messages and roadmap lists are references, not alternative backlogs. If work is missing or conflicts with the backlog, reconcile it with the maintainer before implementing; do not invent a mapping or silently change scope.
- Include the backlog ID and relevant issue links in the PR, update the backlog and member-facing Unreleased notes where applicable, and distinguish implemented, merged and deployed work. Never mark work released from a merge alone.

## Commands

- `npm run build`, `npm run lint` and `npm run test:unit` must all pass. If you change `firestore.rules` or `storage.rules`, `npm run test:rules` must pass too (it needs JDK 21; see `CONTRIBUTING.md`). There are no other automated tests (`test:unit` covers pure functions only), so check the app by hand in your own Firebase project.
- Deploy to Firebase only when you are asked to.
- Follow [post-merge branch cleanup](CONTRIBUTING.md#branch-cleanup-after-merge). The maintainer normally deletes remote feature branches after merge; prominently set **KEEP BRANCH: YES** in the PR with reason, owner and dependencies if retention is needed. Contributors handle local cleanup. Assistants must obtain explicit approval for the exact branch before deleting it themselves, verify its merged PR and unchanged head, and preserve ongoing/unmerged work. No bulk cleanup or automatic force-deletion fallback.

## Rules that must not be broken

- Firestore security rules are the authorization boundary. UI role checks only hide controls, and the VIEW AS preview must never reach a data hook or a write helper.
- Award snapshots (the candidate order and council note at decision time) are immutable. Raids cannot be updated or deleted from the client, and awards cannot be deleted. An award can be edited only by a Guild or Raid Leader in a batch that also writes its audit entry (see `docs/design/audit-first-loot.md`); audit entries can never be changed or deleted.
- Do not imply that local browser data is shared. Only authenticated Firestore data is.
- This repository is public. Never put real character names, account emails, keys or service-account files in code, fixtures, tests or screenshots; use invented names.

## Layout

- `addon/` holds the in-game Lua addon work (a probe so far). It is not part of the web build; the plan is `docs/design/loot-addon.md`. Never copy code from RCLootCouncil (GPL-3.0) or Gargul (All Rights Reserved) into it.
- `src/shell/` is the frame (sidebar, top bar, dialog host, and the tab registry in `tabs.ts`). `src/shared/` holds what features share. `src/features/<name>/` holds one feature each.
- A feature is a `tab.tsx` exporting a `TabDefinition` (written `as const satisfies TabDefinition`, never annotated), a content component, and any dialogs. Register it with one import and one line in `src/shell/tabs.ts`. Do not add feature code to `src/App.tsx`.
- Imports go one way: `core and shared <- features <- shell <- App`. A feature never imports another feature or the shell; shared never imports a feature or the shell.
- Dialogs open with `ctx.openModal(({ close, live }) => <Dialog close={close} live={live} />)`. Read `busy` and anything else that changes from `live`, never from the `ctx` you opened it with.

## Shared files

Changes to these need their own commit and a note in the PR: `src/shared/**`, `src/shell/**`, `src/App.tsx`, `src/App.css`, `src/guildApi.ts`, `src/useGuildData.ts`, `src/useGuildSession.ts`, `src/security.ts`, `firestore.rules`, `storage.rules`, `firebase.json`, `package.json`, `package-lock.json`, `.nvmrc`, and everything under `.github/`. Keep `./App.css` as the last import in `App.tsx`.

## Vocabulary

The code calls unavailable dates "AFK" (`afkEntries`, `AfkCalendar`, the tab id `afk`). Keep those names; the interface says "Raid Calendar" and "unavailable dates".

The Rogue spec is **Combat** everywhere (code, data, docs, UI), never "Outlaw". The spec icons come from a later game version that renamed it; map them to `rogue|combat` in `src/specIcons.ts` and do not rename the spec.

## Do not

- Reformat code you are not changing, or add dependencies without saying why.
- Add wrapper elements or reorder children inside existing components: `App.css` relies on `:nth-child` positions.
