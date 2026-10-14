# Intrepid Guild Raid Desk

- This workspace is a React + TypeScript + Vite guild-loot app using Firebase Authentication and Cloud Firestore.
- Treat Firestore security rules as the authorization boundary; UI role checks only hide actions and impersonation must never grant backend access.
- Preserve immutable award snapshots of the candidate priority order and council note at decision time.
- Do not imply local browser data is shared; only authenticated Firestore data is shared with guild members.
- Run `npm run build` and `npm run lint` to validate changes.
