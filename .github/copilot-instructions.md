# Intrepid Guild Raid Desk

- This workspace is a React + TypeScript + Vite guild-loot app using Firebase Authentication and Cloud Firestore.
- Treat Firestore security rules as the authorization boundary; UI role checks only hide actions and impersonation must never grant backend access.
- Preserve immutable award snapshots of the candidate priority order and council note at decision time.
- Do not imply local browser data is shared; only authenticated Firestore data is shared with guild members.
- Run `npm run build` and `npm run lint` to validate changes.
- Only deploy to firebase when requested to limit the number of pushes to the hosting target.

- Read `AGENTS.md`, `ARCHITECTURE.md` and `CONTRIBUTING.md` before adding a feature: each tab lives in `src/features/<name>/`, is described by a `TabDefinition` in its `tab.tsx`, and is registered in `src/shell/tabs.ts`. Do not add feature code to `src/App.tsx`.
