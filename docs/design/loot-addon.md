# Loot addon: plan and findings from the Forever beta

Status: research. Nothing here is built except the probe addon in `addon/IntrepidProbe/`. Written 2026-10-16 from tests in the WoW: Forever beta (client 1.60.1, build 70425, interface 16001). The beta ends soon, so this records what we learned and what is still unknown, so anyone can carry on.

## Goal

An in-game addon, written for this guild, that works with the Raid Desk:

- the priority lists are set in the app ahead of time;
- when an item drops, the council decides who gets it using the priority and other factors;
- the award is recorded in a form the app can import, with the planned complete audit trail (see [audit-first-loot.md](audit-first-loot.md); only the initial rules stage is implemented).

### Rollout target

Follow [the roadmap](../ROADMAP.md): app scheduling/sign-ups and the first starting snapshot are required for December 9, 2026, independently of addon readiness. Target loot recording from that raid, using need-before-greed rolls without priorities at first; if necessary, record in a spreadsheet for later validated upload. Priority adoption is expected around December 15. The production addon, Discord and advanced automation are included in the December 22 full-rollout target, not the earlier core-web rollout gate. The stages below describe dependencies, not work deferred indefinitely beyond December 22; raise scope/date risks explicitly. The probe is research tooling, not a production loot addon.

It is **not** a fork of RCLootCouncil or a repurposed Gargul. We read how they work and write our own, with only what the Raid Desk needs. RCLootCouncil is GPL-3.0 (copying its code would make ours GPL-3.0) and Gargul is "All Rights Reserved". Ace3 and similar libraries are separately licensed and can be embedded.

## Stages

| Stage | What | Needs messages between players |
| --- | --- | --- |
| v0 loot master tool | Import the priorities from the app (a pasted string). When the loot master opens loot, show each item with its priority order and received marks. The loot master awards it (master loot) or lists it for a trade, and the award is logged. Export the log as a string for the app's importer. | no |
| v1 council | Raiders respond (Need, Upgrade, Off-spec, Pass), the council sees the priority position next to each candidate and votes, the loot master awards. | yes, or voting moves to the web app |
| v2 extras | Attendance snapshot at each boss kill, alt to main mapping, the boss named from the corpse's NPC id, and invites from a locked roster (the app's locked roster is pasted into the addon, one command invites everyone on it and converts the party to a raid). | no |

## How the app and the addon exchange data

Nothing is live: an addon cannot open a connection, and a web page cannot read the game.

1. **Pasted text strings (first versions).** App to game: a "Copy for addon" button builds a string with the locked roster (full names, main or alt, class, role) and the priorities for the night; the leader pastes it into the addon. Game to app: the addon shows a string of awards (recipient, item id, date, boss, response, votes, source id) that the leader pastes into the importer, which previews it first.
2. **A small desktop helper (later).** It watches the addon's saved-variables file (the game writes it on `/reload` or logout), uploads awards, and writes data for the addon to load. No pasting, but every leader installs it.
3. **Votes in the web app** if the game turns out to block addon messages (see open questions).

## What we learned about the Forever client

Probe data from two clients in one party. Raw saved-variable files contain character names and are not published.

| Topic | Finding |
| --- | --- |
| Client | Version 1.60.1, build 70425, interface 16001, `WOW_PROJECT_ID` 18 (its own project; only the MAINLINE and CLASSIC constants exist). Portal "test". |
| API style | The modern namespaced one: `C_PartyInfo`, `C_Item`, `C_Container`, `C_ChatInfo`, `C_AddOns`, `C_Timer`. The old globals `GetLootMethod`, `SetLootMethod`, `GetItemInfo`, `GetContainerItemLink`, `SendAddonMessage`, `RegisterAddonMessagePrefix`, `GetNumAddOns`, `IsAddOnLoaded` do not exist. |
| Loot functions | All exist: `GiveMasterLoot`, `GetMasterLootCandidate`, `GetNumLootItems`, `GetLootSlotInfo`, `GetLootSlotLink`, `GetLootSlotType`, `GetLootSourceInfo`, `LootSlot`, `RollOnLoot`, `GetLootRollItemInfo`, `InitiateTrade`, `ClickTradeButton`, `AcceptTrade`, `GetTradePlayerItemLink`, `GetRaidRosterInfo`. Missing: `AddTradeMoney`. |
| Events | All exist: LOOT_OPENED, LOOT_READY, LOOT_CLOSED, LOOT_SLOT_CLEARED, OPEN_MASTER_LOOT_LIST, LOOT_BIND_CONFIRM, START_LOOT_ROLL, LOOT_ROLLS_COMPLETE, ENCOUNTER_START, ENCOUNTER_END, BOSS_KILL, ENCOUNTER_LOOT_RECEIVED, TRADE_*, CHAT_MSG_ADDON, GROUP_ROSTER_UPDATE, PARTY_LOOT_METHOD_CHANGED. Unknown: LOOT_HISTORY_FULL_UPDATE, LOOT_HISTORY_ROLL_CHANGED, LOOT_HISTORY_AUTO_SHOW. |
| Loot methods | `Enum.LootMethod`: Freeforall 0, Roundrobin 1, Masterlooter 2, Group 3, Needbeforegreed 4, Personal 5. In a party the default is Group with threshold Uncommon. `C_PartyInfo.IsLootMethodAvailable` reports Group, Masterlooter, Roundrobin, Needbeforegreed and Freeforall as available, Personal as not. `C_PartyInfo.SetLootMethod` exists. Master loot was **not yet tested** in a party. |
| Loot windows | LOOT_READY, LOOT_OPENED, LOOT_READY, then per item LOOT_SLOT_CLEARED and `CHAT_MSG_LOOT` ("You receive loot: [link]"), then LOOT_CLOSED. Some events fire twice. Autoloot can empty the window before LOOT_OPENED, leaving no slots to read. Each slot gives item id, quality, slot type. Party members see "Name receives loot: [link]" lines, which carry the looter's player GUID. |
| Naming the boss | `GetLootSourceInfo(slot)` returns the corpse's GUID, `Creature-0-<server>-<instance>-<zone>-<npcId>-<spawn>`. The NPC id inside it can be looked up in a loot-table capture, so the addon can name the boss without any boss event. |
| Item links | New colour-code format (`|cnIQ0:|Hitem:7073::::::::6:1491:::::::::|h[Name]|h|r`). Read the item id with `item:(%d+)`. |
| Trade | Observable: TRADE_SHOW, TRADE_ACCEPT_UPDATE (0,1) then (1,1), then the receiver gets `CHAT_MSG_LOOT` "You receive item: [link]" and TRADE_CLOSED twice. |
| Names | Characters have a first name and a surname, for example "Jorren Ashvale". `UnitName("player")` is the first name, `GetUnitName("player", true)` is the full name, `GetRealmName()` is the realm. The second part of the full name is **not** a realm. Match winners to the roster on the full name (the roster has a surname field) or on the player GUID. Code written for `Name-Realm` breaks: RCLootCouncil, tested here, builds a wrong whisper target from a two-part name. |
| Addon messages | `C_ChatInfo.RegisterAddonMessagePrefix`, `SendAddonMessage`, `SendAddonMessageLogged` exist. `AreOutgoingAddonChatMessagesRestricted()` returned true during probes. `ADDON_RESTRICTION_STATE_CHANGED` fires with (0, 1) at the start of a fight and (0, 0) 10 to 15 seconds later (type 0 is probably Combat). In the first party test, sends from both players returned 0 but **no player received a message**. Not explained yet. |
| Classic addons | Hidden by the client if their TOC says `AllowLoadGameType: classic`. RCLootCouncil Classic 1.3.3 appears once that line is removed; it loads, `/rc` works, but its options throw Lua errors and its error handler fails. Our addon must not set that line. Other testers' clients run many Forever-ready addons (BigWigs, Auctionator, EllesmereUI and others). |
| Encounter Journal | `C_EncounterJournal.GetLootInfo`, `GetLootInfoByIndex`, `GetEncountersOnMap`, `InstanceHasLoot` and `EJ_*` functions exist, but there is no `EJ_GetLootInfoByIndex`. Whether the journal is filled in for Forever is **not yet known**. If it is, an addon command could export boss loot tables, for raids too as soon as the game has them. |

## Open questions

1. **Do addon messages reach other players?** Run probe 0.5 in a party (below). If receiving works at all, other addons' traffic (BigWigs) shows in `/ip show`. If the game blocks them, votes go in the web app.
2. **Can a party use Master Looter in Forever, and in dungeons and raids?** Set it in the party menu, kill something, open the loot, and read `masterLootCandidates` in the log.
3. **Does the Encounter Journal hold loot for Forever dungeons?** Run `/ip ej`.
4. **May an addon invite players** (`C_PartyInfo.InviteUnit`, `ConvertToRaid`)? Run `/ip invite First Surname`.
5. **Are the beta's rules the launch rules?** Retest after launch.

## UI sketch

Three windows modelled on RCLootCouncil's flow, with the app's priority lists in every row. Layout is a first guess.

1. **Loot session window (loot master; v0).** Lists the dropped items, each with its priority order and received marks, and an Award button. The boss comes from the corpse's NPC id.
2. **Raider response popup (v1).** A few buttons per item (Need, Upgrade, Off-spec, Pass) and an optional note, plus what the player has equipped in that slot.
3. **Council voting window (v1).** One tab per item, one row per candidate: player, priority position and how many of their listings are received, response, equipped item, votes and note. Council members get a Vote button, the loot master gets Award.

Left out: RCLootCouncil's many options, translations, version checks, council settings sync, GDKP-style extras. If messages are blocked, windows 2 and 3 become a page in the web app (live through Firestore, council members already have accounts), and the addon keeps window 1 and records the award.

## How to run a test round

See `addon/README.md`. In short: copy `addon/IntrepidProbe/` into the beta's `Interface/AddOns/`, restart the game, run the commands, `/reload`, and read the file the game writes under `WTF/Account/<account>/SavedVariables/IntrepidProbe.lua`. **That file contains character and guild names: do not commit it or paste it into an issue.** Share it privately, or post only the facts.

## How to help

- Run the party test and report which of the open questions above it answers.
- Run `/ip ej` on a character that has seen dungeons and report whether it lists loot.
- Test master loot with two or three players.
- Write the data format (the string the app copies in and the addon exports) as a short spec before any code: see "How the app and the addon exchange data".
