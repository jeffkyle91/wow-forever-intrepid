# The addons: instructions for coding assistants and contributors

The guild's WoW: Forever addons (Lua 5.1, interface 16001), working with the Raid Desk web app. Read `README.md` in this folder first. The repository's own rules (the root `AGENTS.md` and `CONTRIBUTING.md`: backlog IDs, claims, shared files, pull requests) apply here too; this file adds what is particular to the Lua code.

## Rules that must not be broken

- **Licensing.** Do not copy code from RCLootCouncil (GPL-3.0), Gargul (All Rights Reserved) or DungeonJournal (All Rights Reserved; `game/DungeonJournal.lua` only reads it at run time, and its tests use an invented journal), and never copy DungeonJournal's data. Read them to understand an idea, write the requirement in your own words, then write your own code. Ace3 and similar libraries may be embedded with their licenses kept.
- **TOC.** Never set `AllowLoadGameType: classic`. Interface number is `16001`. TOC file names must match the real case exactly (CI is case-sensitive).
- **Lua 5.1 only.** No `goto`, no integer division, no bitwise operators, no `//`. Check with `luacheck`.
- **Names.** Characters have a first name and a surname ("Jorren Ashvale"); the second word is not a realm. Match on the roster's full name or the player GUID, never on the first name alone. Code written for `Name-Realm` is wrong here.
- **Privacy.** This repository is public. Never put real character names, guild names, account emails, keys or saved-variables files in code, tests, fixtures, docs or screenshots. Use invented names (Jorren Ashvale). `results/` and `SavedVariables/` are git-ignored (`addon/.gitignore`); keep it that way.
- **No Firebase.** The addon never talks to Firebase or any server. Data moves as pasted text strings and the saved-variables file.
- **Never break loot mid-raid.** Wrap event handlers in `pcall`, keep an error buffer, and always keep a manual path (the loot master can award by hand). Never enforce what the leadership decided is advisory.
- **Terms of service.** No live, automated in-game probing of the Forever API. The pattern is: a person runs a test, the addon writes a file, someone reads the file afterwards.
- **The record in the app is permanent and audited.** The addon's export must be idempotent (session id and source id per award).
- **Language.** US English.

## Working agreements

- Separate pure logic (priority order, positional completion, tallies, name matching, string encode and decode) from the client. Pure modules get tests in `tests/`; client calls go behind a thin layer.
- Keep the Mac and Windows clients on the same addon version for any message test. Addon messages need two logged-in clients.
- Ask before anything that is hard to reverse or visible to others: pushing, opening issues or PRs, creating repositories, posting publicly.
- Every name the client provides (a method, a namespace member such as `C_PartyInfo.GetLootMethod`, an event, a template, a font object, a
  global) needs an entry in `tools/api-known.json` that names its evidence (a probe result, the self-test or ForeverLoot's code), or an
  `unverified` entry that says why and what to test. Tests of windows use the strict stand-ins in `tests/support/strict_ui.lua`, which
  refuse any name that is not on the list. A window comes with a storyboard in `tests/storyboards/`; its pictures (`lua5.1 tests/storyboards.lua`,
  kept by CI as the `window-pictures` artifact) are looked at in the pull request.
- Windows live in `IntrepidManager/ui/`: they read a view-model and call the callbacks they are given, and never touch the loot API. Build them
  with `ui/Kit`, which is compact by default (one small line per player, the way a loot council shows a candidate, because raids have 40 players;
  "roomy" is the same layout bigger), and give each window a storyboard in `tests/storyboards/`.
- Prefer small, bounded steps. Do not claim a check passed that was not run.
- Commits created with an assistant end with the assistant's `Co-Authored-By` line.

## Commands

Run them from `addon/`. `lua5.1 tests/run.lua` and `luacheck IntrepidManager tests` must both pass, and so must `python3 -B tools/api_lint.py check`
(add `selftest` when you touch the tool or the list; see `tools/README.md`). CI runs these and the rest of the list in `README.md`.
