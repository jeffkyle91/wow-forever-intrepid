# Intrepid Guild Raid Desk

A React, TypeScript, and Vite guild-operations app backed by Firebase Authentication and Cloud Firestore.

## Purpose

Intrepid Guild Raid Desk gives guild leaders, raid leaders, and members one shared place to maintain the roster, organize raid teams, prepare loot-council decisions, and review award history. Guild data is shared through authenticated Firestore access; local browser data is not shared automatically.

## Current functionality

- **My dashboard:** The landing tab. For a member whose account has a linked character, it shows, In the dashboard panel toolbar (next to the character count) it has a Casual / Hardcore raider type switch (hover text explains each; stored per member in `raiderTypes`, readable by every member) and a Raid attendance placeholder (`--`, filled in when attendance tracking is built). Below, in order: that character and its alts, raid team, upcoming raids (flagging dates the member marked unavailable), upcoming absences (with an Add absence button, the same unavailable dates as the Raid Calendar), loot priorities, awarded loot, and a Comments section. A comment is the member's own short note (300 characters), either Public (every guild member can read it) or Leadership (only Guild and Raid Leaders and the author). Each member has one of each, stored in `publicComments` and `leaderComments` with the member's uid as the document id. A member without a linked character sees a short note and keeps the other tabs.
- **Guild roster:** Add and edit characters with a first name, an optional surname, class, specialization, and a raid role (the specialization sets the default; a Guild Leader can change it). A character can be linked to a main as an alt; alts are listed under their main and can be collapsed, or hidden entirely with the All characters / Hide alts toggle (not saved between visits). The roster shows only the first name (the full name appears on hover, and search matches the surname); long names are cut off with an ellipsis so the columns stay fixed. Teams, loot and the calendar use the first name. The complete guild roster remains separate from raid assignments. The Rogue spec is always **Combat**: anything called Rogue Outlaw (the name used by later game versions and some icon sets) is treated as Rogue Combat.
- **Raid teams:** Assign characters to four 10-player teams (Blue, Yellow, Red, and White). Green combines Blue and Yellow; Pink combines Red and White; Brown combines all four. A Guild Leader can rename all of these teams, including the 20- and 40-player ones, in Settings. View role composition and move characters with drag-and-drop or controls.
- **Raid Calendar:** Guild members can add inclusive unavailable date ranges and remove their own entries. Guild and Raid Leaders can schedule 10-, 20-, and 40-player raids by date. Availability and raids appear together on the shared monthly calendar. Guild and Raid Leaders can click a raid to correct its name, date or size, cancel it with a reason, or restore it. A cancelled raid stays on the calendar (struck through, marked Cancelled, and listed as Cancelled on members' dashboards). Every change is saved with an audit entry (`auditLog`, entry id `raid_{id}_{rev}`) in the same batch; Firestore refuses a raid change without it.
- **Loot council:** Track items by encounter with ranked candidates and council notes. Authorized leaders can update the priority list and record awards.
- **Award history:** Review recipients, dates, and decision notes. Each award preserves a snapshot of the candidate order and council note at decision time.
- **Guild access:** Members authenticate and request access. Guild Leaders approve requests, assign roles, and link accounts to roster characters. Firestore rules enforce permissions independently of the UI.
- **Settings (Guild Leaders only):** Edit the sidebar's current and next phase, a status label and indicator color for each phase, the council status (Deliberating while priorities are being discussed, Live once they are set), and the names of the 10-, 20- and 40-player teams. Stored in one document, `settings/general`, that every member reads and only a Guild Leader writes. Until it is saved, or if it cannot be read, the app shows built-in defaults.
- **Guild experience:** Use the app in light or dark theme, with WoW class and specialization artwork.
- **Hosting:** The production app is served from [Firebase Hosting](https://intrepid-wow-forever.web.app/).

## Code map

- **Application shell:** [src/App.tsx](src/App.tsx) owns shared state and lays out the frame; [src/shell/](src/shell/) holds the sidebar, top bar, page heading, stat strip, workspace panel, dialog host, and the tab registry ([src/shell/tabs.ts](src/shell/tabs.ts)); shared layout styling lives in [src/App.css](src/App.css).
- **Features:** each tab lives in its own folder under [src/features/](src/features/) (roster, teams, calendar, loot, access, settings) with its views, dialogs, and actions. Shared building blocks (UI pieces, class and team data, the tab and dialog contracts) live in [src/shared/](src/shared/). See [ARCHITECTURE.md](ARCHITECTURE.md) for how to add a tab and [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution rules.
- **Raid Calendar:** [src/features/calendar/AfkCalendar.tsx](src/features/calendar/AfkCalendar.tsx) and [src/features/calendar/AfkCalendar.css](src/features/calendar/AfkCalendar.css) render the month, availability ranges, and scheduled raids. [src/guildApi.ts](src/guildApi.ts) defines and writes records, while [src/useGuildData.ts](src/useGuildData.ts) subscribes to live guild data.
- **Authentication and role checks:** [src/useGuildSession.ts](src/useGuildSession.ts) resolves sign-in and membership; [src/security.ts](src/security.ts) controls which actions the UI presents.
- **Authorization:** [firestore.rules](firestore.rules) is the backend permission boundary for guild records, raid scheduling, and member availability.
- **Firebase configuration and hosting:** [src/firebase.ts](src/firebase.ts) initializes the client from environment values; [firebase.json](firebase.json) configures Firestore rules and Hosting rewrites; [vite.config.ts](vite.config.ts) configures the frontend build.

## Discussed future work

These ideas have been discussed but are not implemented as part of this app yet:

The decisions taken and the order of work are in [docs/ROADMAP.md](docs/ROADMAP.md).

- Loot Priorities and Award History: Reworking the existing [loot-council app](https://intrepid-reforged-p2-loot-tracker.netlify.app/) and selectively adapt useful workflows if its source repository becomes available. This project was started independently while waiting for that repository.
    - Interfacing loot from an outside source to populate the items in the loot priority list.
- Raid Optimziation: Add a raid optimization tool to evaluate buffs and debuffs by class to ensure raids (10/20/40) have the best use of classes/specs available.
- Attendance Tracker: Ability to discern benched (voluntary/involuntary) and attendance %
    - Interfacing with warcraft logs to evaluate who contributed to a raid
    - Manual input in case a log is missed


## Local setup

Requires Node.js 24.12 or newer (`.nvmrc` selects Node 24; get it from nodejs.org or a version manager such as nvm or fnm). Node 22.12+ also builds, but npm prints unsupported-engine warnings for the Firebase packages.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

### Try changes locally without touching production

```powershell
npm run dev:emulator
```

Starts the Firebase Auth and Firestore emulators with your current `firestore.rules`, seeds an invented guild, and runs the app against them (it ignores `.env.local`). It needs Java 21, the same as `npm run test:rules`. Sign in as `leader@example.test` (Guild Leader), `raider@example.test` (Raid Leader) or `member@example.test` (Member) with the password `password123`. Data is discarded when you stop it and nothing reaches the live Firebase project, so rules changes can be tried here before they are deployed.

## Firebase Hosting

The Firebase Hosting target serves the Vite production build from `dist` and rewrites app routes to `index.html`. Configure the Firebase values in `.env.local`, then build and deploy the hosting target:

```powershell
npm run build
npx firebase-tools@latest deploy --only hosting --project intrepid-wow-forever
```

`npm run release` runs this whole sequence from a clean `main` (see CONTRIBUTING.md); use it only when a deploy was asked for.

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

If a Guild Leader is shown "Request guild access" after signing in, `VITE_GUILD_ID` or the UID in `guilds/<VITE_GUILD_ID>/members/<UID>` is wrong. If the access check fails outright, the "Could not verify access" screen shows the Firestore error code and the guild ID the build is using.

When approving a join request, a Guild Leader can optionally connect the account to an existing roster character. Existing accounts can also be linked or reassigned from Member Access. Links use stable roster document IDs, and Firestore rules require the roster and membership references to agree. A roster character can be linked to at most one account through the Guild Leader workflow. Only main characters are offered for linking; alts cannot be linked to an account (this is a UI filter, not a rules check).

Without Firebase configuration, the app intentionally shows a setup-required screen. There is no client-side role selector that grants access.

## Roles

- **Guild Leader:** manage guild roster, raid teams, loot priorities, awards, member access, and role assignments; schedule raids and manage their own unavailable dates.
- **Raid Leader:** manage raid teams, loot priorities, and awards; view the guild roster and history; schedule raids and manage their own unavailable dates.
- **Member:** read guild data and add or remove their own AFK date ranges.

Guild Leader impersonation only narrows the visible UI to preview a role. It does not change the authenticated identity or the permissions enforced by Firestore.

## Existing local preview data

A Guild Leader can import this browser's prior local preview records from Member Access when the shared guild collections are empty. The import carries roster assignments and award-time priority snapshots. Local browser data is not uploaded automatically.

## License and credits

This is an unofficial fan project for a World of Warcraft guild. It is not affiliated with or endorsed by Blizzard Entertainment. World of Warcraft and the names, class and specialization artwork it refers to are trademarks or property of Blizzard Entertainment.

- **Code:** [MIT](LICENSE). The license covers the source code only, not the artwork below.
- **Specialization icons** (`wowspecsemojis-master/`): from [danetch/wowspecsemojis](https://github.com/danetch/wowspecsemojis), which shares the original Blizzard specialization icons as PNGs. They remain Blizzard artwork; they are used here for a non-commercial guild app and must not be used commercially.
- **Guild crest and interface artwork** (`Art/`): generated with ChatGPT (OpenAI). They are not Blizzard artwork.

## Checks

```powershell
npm run build
npm run lint
```

`npm run lint` treats warnings as errors. GitHub Actions (`.github/workflows/ci.yml`) runs both commands on every pull request and on pushes to `main`.

The Firestore rules have their own tests, which run against the local emulator and need JDK 21 (see [CONTRIBUTING.md](CONTRIBUTING.md#testing-the-firestore-rules)):

```powershell
npm run test:rules
```

CI runs them in a separate job.
