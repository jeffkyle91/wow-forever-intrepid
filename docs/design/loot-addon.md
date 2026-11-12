# Loot addon: plan and findings from the Forever beta

Status: researched in the WoW: Forever beta, 2026-10-16 to 22 (client 1.60.1, builds 70425 to 70450, interface 16001). Rechecking it on the live client is ADDON-001 (#193). The addon itself, Intrepid Manager (build 0.0.17), was built in a separate private repository during the beta, and moves into `addon/` with ADDON-002. Written 2026-10-16, updated 2026-11-12.

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

1. **Pasted text strings (first versions, decided).** App to game: a "Copy for addon" button builds a string with the locked roster (full names, main or alt, class, role) and the priorities for the night; the leader pastes it into the addon. Game to app: the addon shows a string of awards (recipient, item id, date, boss, response, votes, source id) that the leader pastes into the importer, which previews it first. The format is [`docs/spec/exchange-v0.md`](../spec/exchange-v0.md) (ADDON-001), and the importer's design is [`award-import.md`](award-import.md) (LOOT-005).
2. **A small desktop helper (later, only if pasting and the file-read idea below both annoy people).** It watches the addon's saved-variables file (the game writes it on `/reload` or logout), uploads awards, and writes data for the addon to load. No pasting, but every leader installs it.
3. **Whisper or chat commands for votes** if the game turns out to block addon messages (see open questions). Voting stays in the game: the app holds priorities and the record, not the vote.

## What we learned about the Forever client

Probe and addon data from the beta: two clients in a party, in a raid group and in a five-player dungeon. Raw saved-variable files contain character names and are not published. The live client (build 70634 on 2026-11-11) is rechecked under ADDON-001.

| Topic | Finding |
| --- | --- |
| Client | Version 1.60.1, build 70425, interface 16001, `WOW_PROJECT_ID` 18 (its own project; only the MAINLINE and CLASSIC constants exist). Portal "test". |
| API style | The modern namespaced one: `C_PartyInfo`, `C_Item`, `C_Container`, `C_ChatInfo`, `C_AddOns`, `C_Timer`. The old globals `GetLootMethod`, `SetLootMethod`, `GetItemInfo`, `GetContainerItemLink`, `SendAddonMessage`, `RegisterAddonMessagePrefix`, `GetNumAddOns`, `IsAddOnLoaded` do not exist. |
| Loot functions | All exist: `GiveMasterLoot`, `GetMasterLootCandidate`, `GetNumLootItems`, `GetLootSlotInfo`, `GetLootSlotLink`, `GetLootSlotType`, `GetLootSourceInfo`, `LootSlot`, `RollOnLoot`, `GetLootRollItemInfo`, `InitiateTrade`, `ClickTradeButton`, `AcceptTrade`, `GetTradePlayerItemLink`, `GetRaidRosterInfo`. Missing: `AddTradeMoney`. |
| Events | All exist: LOOT_OPENED, LOOT_READY, LOOT_CLOSED, LOOT_SLOT_CLEARED, OPEN_MASTER_LOOT_LIST, LOOT_BIND_CONFIRM, START_LOOT_ROLL, LOOT_ROLLS_COMPLETE, ENCOUNTER_START, ENCOUNTER_END, BOSS_KILL, ENCOUNTER_LOOT_RECEIVED, TRADE_*, CHAT_MSG_ADDON, GROUP_ROSTER_UPDATE, PARTY_LOOT_METHOD_CHANGED. Unknown: LOOT_HISTORY_FULL_UPDATE, LOOT_HISTORY_ROLL_CHANGED, LOOT_HISTORY_AUTO_SHOW. |
| Loot methods | `Enum.LootMethod`: Freeforall 0, Roundrobin 1, Masterlooter 2, Group 3, Needbeforegreed 4, Personal 5. In a party the default is Group with threshold Uncommon. `C_PartyInfo.IsLootMethodAvailable` reports Group, Masterlooter, Roundrobin, Needbeforegreed and Freeforall as available, Personal as not. `C_PartyInfo.SetLootMethod` exists. Master Looter works in a party and in a five-player dungeon. The game's menu offers thresholds from Uncommon up, but a leader's command lowered it to Common and to Poor, and Master Looter then offers white and gray items too. |
| Loot windows | LOOT_READY, LOOT_OPENED, LOOT_READY, then per item LOOT_SLOT_CLEARED and `CHAT_MSG_LOOT` ("You receive loot: [link]"), then LOOT_CLOSED. Some events fire twice. Autoloot can empty the window before LOOT_OPENED, leaving no slots to read. Each slot gives item id, quality, slot type. Party members see "Name receives loot: [link]" lines, which carry the looter's player GUID. |
| Master loot | `GiveMasterLoot(slot, number)` from an addon works, and hands out a bind-on-pickup item with no confirmation, so the addon asks first. `GetMasterLootCandidate` numbers the candidates in an order that changes between groups: find the number by full name each time. A hand-out to a player with full bags is silent for the loot master (only the recipient sees "Inventory is full."), so confirm it with `LOOT_SLOT_CLEARED` and the "receives loot" line. The recipient can trade a bind-on-pickup item for 4 hours to anyone who could have looted it. Request Roll only collects Need, Greed and Pass: nothing is awarded, and the item stays until the loot master gives it. |
| Naming the boss | `GetLootSourceInfo(slot)` returns the corpse's GUID, `Creature-0-<server>-<instance>-<zone>-<npcId>-<spawn>`. The NPC id inside it can be looked up in a loot-table capture, so the addon can name the boss without any boss event. |
| Item links | New color-code format (`|cnIQ0:|Hitem:7073::::::::6:1491:::::::::|h[Name]|h|r`). Read the item id with `item:(%d+)`. |
| Trade | Observable: TRADE_SHOW, TRADE_ACCEPT_UPDATE (0,1) then (1,1), then the receiver gets `CHAT_MSG_LOOT` "You receive item: [link]" and TRADE_CLOSED twice. An addon can open the trade and place the item (`InitiateTrade`, `ClickTradeButton`); both players still press Trade. |
| Names | Characters have a first name and a surname, for example "Jorren Ashvale". `UnitName("player")` is the first name, `GetUnitName("player", true)` is the full name, `GetRealmName()` is the realm. The second part of the full name is **not** a realm. Match winners to the roster on the full name (the roster has a surname field) or on the player GUID. Code written for `Name-Realm` breaks: RCLootCouncil, tested here, builds a wrong whisper target from a two-part name. |
| Addon messages | `C_ChatInfo.RegisterAddonMessagePrefix`, `SendAddonMessage` and `SendAddonMessageLogged` exist, and messages arrive in party, raid and whisper, also in ordinary combat. **During a boss encounter the game refuses them** (`AddOnMessageLockdown`, 11) from `ENCOUNTER_START` to `ENCOUNTER_END`; a loot window only opens after the kill. `AreOutgoingAddonChatMessagesRestricted()` reads true all the time, so test the send's result or the restriction events instead. Measured with two clients: 10 messages per prefix at once, then 1 per second; 255 bytes at most (longer is cut); party and raid messages arrive in order in about 0.25 seconds; whispers can arrive out of order. The first party test, where nothing arrived, stays unexplained; every later round worked. |
| Classic addons | Hidden by the client if their TOC says `AllowLoadGameType: classic`. RCLootCouncil Classic 1.3.3 appears once that line is removed; it loads, `/rc` works, but its options throw Lua errors and its error handler fails. Our addon must not set that line. Other testers' clients run many Forever-ready addons (BigWigs, Auctionator, EllesmereUI and others). |
| Encounter Journal | `C_EncounterJournal.GetLootInfo`, `GetLootInfoByIndex`, `GetEncountersOnMap`, `InstanceHasLoot` and `EJ_*` functions exist, but there is no `EJ_GetLootInfoByIndex`. A tester reports that the journal has loot, but only entries relevant to the character's level appear (about level 16 for the first dungeons), so `/ip ej` needs a character of that level (at level 7 the calls run and return nothing). If it lists loot, an addon command could export boss loot tables, for raids too as soon as the game has them. |
| Invites | An addon can invite a player by full name (`C_PartyInfo.InviteUnit`) and turn the party into a raid (`ConvertToRaid`). Master Looter and the threshold survive the conversion. |
| Pasting | A 100,000-character string pasted into an edit box arrives intact, and survives `/reload` in the saved variables. |
| Encoding helpers | `bit.bxor` (it returns unsigned numbers), `GetServerTime` and `C_EncodingUtil.DeserializeJSON` exist. Reading a 100-item night string takes about 10 ms. |

## Open questions

The beta answered the first ones asked here: addon messages reach other players, Master Looter works, an addon may invite and convert to a raid, and a long paste arrives intact. Still open:

1. **Does the live client behave as the beta did?** Recheck the findings above on the live client (ADDON-001, #193).
2. **Three or more players with the addon at once,** and a 40-player raid: delivery and throttling under real load.
3. **Master Looter in a raid group:** a party was turned into a raid, but no loot was opened in it.
4. **What does `/ip ej` dump on a character of level 16 or more?** Raid loot only once raids open.

## UI sketch

Three windows modelled on RCLootCouncil's flow, with the app's priority lists in every row. Layout is a first guess.

1. **Session builder (loot master; v0).** When a boss dies the addon lists the items that dropped (the boss named from the corpse's NPC id). The loot master edits the list (remove items, add items from bags) and starts the session.
2. **Response popup (every raider with the addon).** Everyone in the raid sees the session; only raiders who can use an item get the buttons (default Best in slot, Upgrade, Off-spec, Pass, configurable) and an optional note. Someone without the addon whispers the loot master, who enters the response (as LootReserve allows).
3. **Voting window (v1).** Everyone sees it; only council members (the leadership roles plus a rotating group chosen per raid) get a Vote button. One tab per item, one row per candidate: name, guild rank, response, item level and difference, equipped items, priority position and how many of that player's listings are received, attendance, raider type, main or alt, recent receipts, votes (hover shows who voted), notes and roll. A header shows "N out of M have voted" and a countdown (60 seconds by default, configurable). Ties are broken with `/roll`. The loot master awards; Disenchant and Guild bank are also award choices.

Left out: RCLootCouncil's many options, translations, version checks, council settings sync, GDKP-style extras. Voting stays in the game. If addon messages are blocked, window 3 takes votes from whisper or chat commands read by the loot master's addon instead of from the council members' addons.

## How to run a test round

See `addon/README.md`. In short: copy `addon/IntrepidProbe/` into the game's `Interface/AddOns/` (in the `_forever_` folder of the World of Warcraft install), restart the game, run the commands, `/reload`, and read the file the game writes under `WTF/Account/<account>/SavedVariables/IntrepidProbe.lua`. **That file contains character and guild names: do not commit it or paste it into an issue.** Share it privately, or post only the facts.

## How to help

- Run the probe on the live client and report which findings above changed.
- Run `/ip ej` on a character of level 16 or more and report whether it lists loot.
- Test master loot and addon messages with two or three players.
