# Intrepid Guild Raid Desk

A React, TypeScript, and Vite guild-operations app backed by Firebase Authentication and Cloud Firestore.

## Purpose

Intrepid Guild Raid Desk gives guild leaders, raid leaders, and members one shared place to maintain the roster, organize raid teams, prepare loot-council decisions, and review award history. Guild data is shared through authenticated Firestore access; local browser data is not shared automatically.

## Current functionality

- **Guild roster:** Add and edit characters with class, specialization, and a role derived from specialization. The complete guild roster remains separate from raid assignments.
- **Raid teams:** Assign characters to four 10-player teams (Blue, Yellow, Red, and White). Green combines Blue and Yellow; Pink combines Red and White; Brown combines all four. View role composition and move characters with drag-and-drop or controls.
- **Raid Calendar:** Guild members can add inclusive unavailable date ranges and remove their own entries. Guild and Raid Leaders can schedule 10-, 20-, and 40-player raids by date. Availability and raids appear together on the shared monthly calendar.
- **Loot council:** Track items by encounter with ranked candidates and council notes. Authorized leaders can update the priority list and record awards.
- **Award history:** Review recipients, dates, and decision notes. Each award preserves a snapshot of the candidate order and council note at decision time.
- **Guild access:** Members authenticate and request access. Guild Leaders approve requests, assign roles, and link accounts to roster characters. Firestore rules enforce permissions independently of the UI.
- **Guild experience:** Use the app in light or dark theme, with WoW class and specialization artwork.
- **Hosting:** The production app is served from [Firebase Hosting](https://intrepid-wow-forever.web.app/).

## Code map

- **Application shell and workflows:** [src/App.tsx](src/App.tsx) connects navigation, feature views, role-based controls, and dialogs; shared layout styling lives in [src/App.css](src/App.css).
- **Raid Calendar:** [src/AfkCalendar.tsx](src/AfkCalendar.tsx) and [src/AfkCalendar.css](src/AfkCalendar.css) render the month, availability ranges, and scheduled raids. [src/guildApi.ts](src/guildApi.ts) defines and writes records, while [src/useGuildData.ts](src/useGuildData.ts) subscribes to live guild data.
- **Authentication and role checks:** [src/useGuildSession.ts](src/useGuildSession.ts) resolves sign-in and membership; [src/security.ts](src/security.ts) controls which actions the UI presents.
- **Authorization:** [firestore.rules](firestore.rules) is the backend permission boundary for guild records, raid scheduling, and member availability.
- **Firebase configuration and hosting:** [src/firebase.ts](src/firebase.ts) initializes the client from environment values; [firebase.json](firebase.json) configures Firestore rules and Hosting rewrites; [vite.config.ts](vite.config.ts) configures the frontend build.

## Discussed future work

These ideas have been discussed but are not implemented as part of this app yet:

- Loot Priorities and Award History: Reworking the existing [loot-council app](https://intrepid-reforged-p2-loot-tracker.netlify.app/) and selectively adapt useful workflows if its source repository becomes available. This project was started independently while waiting for that repository.
    - Interfacing loot from an outside source to populate the items in the loot priority list.
- Raid Optimziation: Add a raid optimization tool to evaluate buffs and debuffs by class to ensure raids (10/20/40) have the best use of classes/specs available.
- Attendance Tracker: Ability to discern benched (voluntary/involuntary) and attendance %
    - Interfacing with warcraft logs to evaluate who contributed to a raid
    - Manual input in case a log is missed
- Add a setting tool to update season and status indicators


## Local setup

Requires Node.js 24.12 or newer (`.nvmrc` selects Node 24; get it from nodejs.org or a version manager such as nvm or fnm). Node 22.12+ also builds, but npm prints unsupported-engine warnings for the Firebase packages.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

## Firebase Hosting

The Firebase Hosting target serves the Vite production build from `dist` and rewrites app routes to `index.html`. Configure the Firebase values in `.env.local`, then build and deploy the hosting target:

```powershell
npm run build
npx firebase-tools@latest deploy --only hosting --project intrepid-wow-forever
```

The deployed site is [intrepid-wow-forever.web.app](https://intrepid-wow-forever.web.app/). Hosting deployment does not deploy Firestore rules; deploy those separately when the rules change.

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

- **Guild Leader:** manage guild roster, raid teams, loot priorities, awards, member access, and role assignments; schedule raids and manage their own unavailable dates.
- **Raid Leader:** manage raid teams, loot priorities, and awards; view the guild roster and history; schedule raids and manage their own unavailable dates.
- **Member:** read guild data and add or remove their own AFK date ranges.

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

`npm run lint` treats warnings as errors. GitHub Actions (`.github/workflows/ci.yml`) runs both commands on every pull request and on pushes to `main`.
