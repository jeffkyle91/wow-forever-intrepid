# Intrepid Guild Raid Desk

A React, TypeScript, and Vite guild-operations app backed by Firebase Authentication and Cloud Firestore.

## Local setup

Requires Node.js 20.19+ or 22.12+.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

## Raid team building

The Raid Teams view shows the complete guild roster grouped into collapsible Tank, Healer, Melee, and Ranged lists. Drag a character onto a 10-player team to assign or move them; drag an assigned character back to the roster list to unassign them. Team add/move controls remain available without dragging. The 20- and 40-player teams derive from the four 10-player groups.

Set the Firebase web-app values and a stable guild document ID in `.env.local`. These public Firebase client settings identify the app; Firestore rules enforce data access. Never put service-account credentials in the web app or commit `.env.local`.

```text
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
VITE_GUILD_ID=
```

## Firebase project setup

1. Create a Firebase project and register a web app.
2. Enable Email/Password under Authentication sign-in providers.
3. Create a Cloud Firestore database.
4. Deploy the rules in `firestore.rules` using `npx firebase-tools@latest deploy --only firestore:rules --project <project-id>`.
5. Create the first user in Firebase Authentication. Copy that user's UID and create `guilds/<VITE_GUILD_ID>/members/<UID>` in Firestore with `email`, `displayName`, and `role: "Guild Leader"` fields.
6. Sign in with that account. Guild Leaders can review access requests and assign roles in Member Access.

When approving a join request, a Guild Leader can optionally connect the account to an existing roster character. Existing accounts can also be linked or reassigned from Member Access. Links use stable roster document IDs, and Firestore rules require the roster and membership references to agree. A roster character can be linked to at most one account through the Guild Leader workflow.

Without Firebase configuration, the app intentionally shows a setup-required screen. There is no client-side role selector that grants access.

## Roles

- **Guild Leader:** manage guild roster, raid teams, loot priorities, awards, member access, and role assignments.
- **Raid Leader:** manage raid teams, loot priorities, and awards; view the guild roster and history.
- **Member:** read-only access to guild roster, teams, priorities, and award history.

Guild Leader impersonation only narrows the visible UI to preview a role. It does not change the authenticated identity or the permissions enforced by Firestore.

## Existing local preview data

A Guild Leader can import this browser's prior local preview records from Member Access when the shared guild collections are empty. The import carries roster assignments and award-time priority snapshots. Local browser data is not uploaded automatically.

## Specialization icons

The specialization PNGs in `wowspecsemojis-master/` are from [danetch/wowspecsemojis](https://github.com/danetch/wowspecsemojis) and are used here for this non-commercial guild app under the Blizzard fan-content allowance described by the project owner. The icons remain Blizzard artwork; do not use them commercially.

## Checks

```powershell
npm run build
npm run lint
```
