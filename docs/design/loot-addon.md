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
| v1 council | Raiders respond (Need, Upgrade, Off-spec, Pass), the council sees the priority position next to each candidate and votes, the loot master awards. Council voting stays **in the game**. | yes (addon messages); if the game blocks them, whisper or chat commands read by the loot master's addon |
| v2 extras | Attendance snapshot at each boss kill, alt to main mapping, the boss named from the corpse's NPC id, and invites from a locked roster (the app's locked roster is pasted into the addon, one command invites everyone on it and converts the party to a raid). | no |

## Decisions so far

From the guild's loot council practice and the leadership's answers (2026-10-16):

- **Voting happens in the game.** The app holds priorities and the record, not the vote.
- **Council.** The leadership roles plus a rotating group of members, rotated monthly. The rotation is managed on the website (the app suggests who is next; a selected member can opt out and another is drawn). The month's council travels to the addon with the roster.
- **Who runs it.** One long-term loot master (more if 10 and 20 player councils are run). Everyone in the raid installs the addon and responds; a player without it whispers the loot master, who enters the response.
- **Responses.** Configurable buttons, one set for everything (default Best in slot, Upgrade, Off-spec, Pass). 60 seconds per item by default, configurable. Ties are broken with `/roll`.
- **Priority is advisory.** It is a column in the voting window. Attendance, raider type, main or alt, recent receipts, the equipped item and the player's note are shown, never enforced.
- **Visibility.** Everyone in the raid sees the voting window and the tallies; hovering a vote count shows who voted; only council members get the Vote button.
- **Columns.** RCLootCouncil's, without item level and item level difference (and probably without rank), plus the priority position and the factors above.
- **Sessions.** Independent of the item quality threshold (all items while testing). Built from what the boss dropped, then edited by the loot master (remove items, add items from bags) before starting.
- **Awards.** Both master loot from the corpse and trading later. The addon knows the winner and assigns the item from the loot window when it is there. **Assigned and received are tracked separately**, with a hand-out list for the loot master and "items owed to you" in the app; leaders and the loot master can also mark an item received by hand (audited).
- **Disenchant and Guild bank** are awards to a pseudo recipient.
- **Scope.** Council tooling is mainly for the top raid tier; the lower tiers are decided later.

## How the app and the addon exchange data

Nothing is live: an addon cannot open a connection, and a web page cannot read the game.

1. **Pasted text strings (first versions, decided).** App to game: a "Copy for addon" button builds a string with the locked roster (full names, main or alt, class, role) and the priorities for the night; the leader pastes it into the addon. Game to app: the addon shows a string of awards (recipient, item id, date, boss, response, votes, source id) that the leader pastes into the importer, which previews it first.
2. **A small desktop helper (later, only if pasting and the file-read idea below both annoy people).** It watches the addon's saved-variables file (the game writes it on `/reload` or logout), uploads awards, and writes data for the addon to load. No pasting, but every leader installs it.
3. **Whisper or chat commands for votes** if the game turns out to block addon messages (see open questions). Voting stays in the game: the app holds priorities and the record, not the vote.

## What we learned about the Forever client

Probe data from two clients in one party. Raw saved-variable files contain character names and are not published.

| Topic | Finding |
| --- | --- |
| Client | Version 1.60.1, build 70425, interface 16001, `WOW_PROJECT_ID` 18 (its own project; only the MAINLINE and CLASSIC constants exist). Portal "test". |
| API style | The modern namespaced one: `C_PartyInfo`, `C_Item`, `C_Container`, `C_ChatInfo`, `C_AddOns`, `C_Timer`. The old globals `GetLootMethod`, `SetLootMethod`, `GetItemInfo`, `GetContainerItemLink`, `SendAddonMessage`, `RegisterAddonMessagePrefix`, `GetNumAddOns`, `IsAddOnLoaded` do not exist. |
| Loot functions | All exist: `GiveMasterLoot`, `GetMasterLootCandidate`, `GetNumLootItems`, `GetLootSlotInfo`, `GetLootSlotLink`, `GetLootSlotType`, `GetLootSourceInfo`, `LootSlot`, `RollOnLoot`, `GetLootRollItemInfo`, `InitiateTrade`, `ClickTradeButton`, `AcceptTrade`, `GetTradePlayerItemLink`, `GetRaidRosterInfo`. Missing: `AddTradeMoney`. |
| Events | All exist: LOOT_OPENED, LOOT_READY, LOOT_CLOSED, LOOT_SLOT_CLEARED, OPEN_MASTER_LOOT_LIST, LOOT_BIND_CONFIRM, START_LOOT_ROLL, LOOT_ROLLS_COMPLETE, ENCOUNTER_START, ENCOUNTER_END, BOSS_KILL, ENCOUNTER_LOOT_RECEIVED, TRADE_*, CHAT_MSG_ADDON, GROUP_ROSTER_UPDATE, PARTY_LOOT_METHOD_CHANGED. Unknown: LOOT_HISTORY_FULL_UPDATE, LOOT_HISTORY_ROLL_CHANGED, LOOT_HISTORY_AUTO_SHOW. |
| Loot methods | `Enum.LootMethod`: Freeforall 0, Roundrobin 1, Masterlooter 2, Group 3, Needbeforegreed 4, Personal 5. In a party the default is Group with threshold Uncommon. `C_PartyInfo.IsLootMethodAvailable` reports Group, Masterlooter, Roundrobin, Needbeforegreed and Freeforall as available, Personal as not. `C_PartyInfo.SetLootMethod` exists. A tester reports that a party can use Master Looter, but only for items of Uncommon (green) quality and above. |
| Loot windows | LOOT_READY, LOOT_OPENED, LOOT_READY, then per item LOOT_SLOT_CLEARED and `CHAT_MSG_LOOT` ("You receive loot: [link]"), then LOOT_CLOSED. Some events fire twice. Autoloot can empty the window before LOOT_OPENED, leaving no slots to read. Each slot gives item id, quality, slot type. Party members see "Name receives loot: [link]" lines, which carry the looter's player GUID. |
| Naming the boss | `GetLootSourceInfo(slot)` returns the corpse's GUID, `Creature-0-<server>-<instance>-<zone>-<npcId>-<spawn>`. The NPC id inside it can be looked up in a loot-table capture, so the addon can name the boss without any boss event. |
| Item links | New color-code format (`|cnIQ0:|Hitem:7073::::::::6:1491:::::::::|h[Name]|h|r`). Read the item id with `item:(%d+)`. |
| Trade | Observable: TRADE_SHOW, TRADE_ACCEPT_UPDATE (0,1) then (1,1), then the receiver gets `CHAT_MSG_LOOT` "You receive item: [link]" and TRADE_CLOSED twice. |
| Names | Characters have a first name and a surname, for example "Jorren Ashvale". `UnitName("player")` is the first name, `GetUnitName("player", true)` is the full name, `GetRealmName()` is the realm. The second part of the full name is **not** a realm. Match winners to the roster on the full name (the roster has a surname field) or on the player GUID. Code written for `Name-Realm` breaks: RCLootCouncil, tested here, builds a wrong whisper target from a two-part name. |
| Addon messages | `C_ChatInfo.RegisterAddonMessagePrefix`, `SendAddonMessage`, `SendAddonMessageLogged` exist. `AreOutgoingAddonChatMessagesRestricted()` returned true during probes. `ADDON_RESTRICTION_STATE_CHANGED` fires with (0, 1) at the start of a fight and (0, 0) 10 to 15 seconds later (type 0 is probably Combat). In the first party test, sends from both players returned 0 but **no player received a message**. Not explained yet. |
| Classic addons | Hidden by the client if their TOC says `AllowLoadGameType: classic`. RCLootCouncil Classic 1.3.3 appears once that line is removed; it loads, `/rc` works, but its options throw Lua errors and its error handler fails. Our addon must not set that line. Other testers' clients run many Forever-ready addons (BigWigs, Auctionator, EllesmereUI and others). |
| Encounter Journal | `C_EncounterJournal.GetLootInfo`, `GetLootInfoByIndex`, `GetEncountersOnMap`, `InstanceHasLoot` and `EJ_*` functions exist, but there is no `EJ_GetLootInfoByIndex`. A tester reports that the journal has loot, but only entries relevant to the character's level appear (about level 16 for the first dungeons), so `/ip ej` needs a character of that level. If it lists loot, an addon command could export boss loot tables, for raids too as soon as the game has them. |

## Open questions

1. **Do addon messages reach other players?** Run probe 0.5 in a party (below). If receiving works at all, other addons' traffic (BigWigs) shows in `/ip show`. If the game blocks them, votes use whisper or chat commands that the loot master's addon reads (RCLootCouncil has whisper commands too).
2. **Does Master Looter work in dungeons and raids, and what does the loot window give the loot master?** Set it in the party menu, kill something worth Uncommon or better, open the loot, and read `masterLootCandidates` in the log.
3. **What does `/ip ej` dump on a character of level 16 or more?** Run it and compare with the dungeon loot lists.
4. **May an addon invite players** (`C_PartyInfo.InviteUnit`, `ConvertToRaid`)? Not known; run `/ip invite First Surname`.
5. **Are the beta's rules the launch rules?** Retest after launch.

## UI sketch

Three windows modelled on RCLootCouncil's flow, with the app's priority lists in every row. Layout is a first guess.

1. **Session builder (loot master; v0).** When a boss dies the addon lists the items that dropped (the boss named from the corpse's NPC id). The loot master edits the list (remove items, add items from bags) and starts the session.
2. **Response popup (every raider with the addon).** Everyone in the raid sees the session; only raiders who can use an item get the buttons (default Best in slot, Upgrade, Off-spec, Pass, configurable) and an optional note. Someone without the addon whispers the loot master, who enters the response (as LootReserve allows).
3. **Voting window (v1).** Everyone sees it; only council members (the leadership roles plus a rotating group chosen per raid) get a Vote button. One tab per item, one row per candidate: name, guild rank, response, item level and difference, equipped items, priority position and how many of that player's listings are received, attendance, raider type, main or alt, recent receipts, votes (hover shows who voted), notes and roll. A header shows "N out of M have voted" and a countdown (60 seconds by default, configurable). Ties are broken with `/roll`. The loot master awards; Disenchant and Guild bank are also award choices.

Left out: RCLootCouncil's many options, translations, version checks, council settings sync, GDKP-style extras. Voting stays in the game. If addon messages are blocked, window 3 takes votes from whisper or chat commands read by the loot master's addon instead of from the council members' addons.

## How to run a test round

See `addon/README.md`. In short: copy `addon/IntrepidProbe/` into the beta's `Interface/AddOns/`, restart the game, run the commands, `/reload`, and read the file the game writes under `WTF/Account/<account>/SavedVariables/IntrepidProbe.lua`. **That file contains character and guild names: do not commit it or paste it into an issue.** Share it privately, or post only the facts.

## How to help

- Run the party test and report which of the open questions above it answers.
- Run `/ip ej` on a character that has seen dungeons and report whether it lists loot.
- Test master loot with two or three players.
- Write the data format (the string the app copies in and the addon exports) as a short spec before any code: see "How the app and the addon exchange data".
