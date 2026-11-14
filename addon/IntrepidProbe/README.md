# IntrepidProbe

A developer tool. It only reads and records what the Forever client offers and what happens when loot drops; it changes nothing in the game and sends nothing over the internet. Everything it records goes to its own saved-variables file, which contains character and guild names: **never commit it or paste it into an issue**.

**Install:** copy this `IntrepidProbe` folder into the live game's `_forever_/Interface/AddOns/` folder, restart the game, tick **Intrepid Probe** under **AddOns**, and type `/console scriptErrors 1` so Lua errors show. A new version only needs `/reload`; a new folder needs a full restart.

| Command | What it does |
| --- | --- |
| `/ip bundle [label]` | Runs every safe check in one go (client and group facts, name and screen forms as shapes only, guild roster shapes, window templates, a safe invite and raid-conversion check, the client's own loot and trade message texts, API names, the Encounter Journal, and the item ids of the Raid Desk's loot tables), then switches the event log on and names the run. See `Bundle.lua`. |
| `/ip bags` | Lists the bound items in your bags and the tooltip lines that mention trading them (the trade window of bind-on-pickup loot, if this client has one). Nothing is changed. |
| `/ip give [slot who]` | With the loot window open: lists the item slots and their master loot candidates (numbered); or gives a slot to a candidate (a number or a full name) with `GiveMasterLoot` and records what the game answers in the next 3 seconds (blocked, a confirmation, an error message, the slot cleared). The only command here that changes the game, exactly as a click in the master loot list does. |
| `/ip group` | Records who is in the group (every name as its form only), who leads, the values the loot method function returns, the units of the party or raid, and the raid roster rows (the eleventh value says who the master looter is). |
| `/ip raid` | Turns the party into a raid with `ConvertToRaid` (only the leader, only in a group that is not a raid) and records, for 3 seconds, what the game answers and whether the group became a raid. |
| `/ip history` | Records what the game remembers of this session's loot rolls and drops (`C_LootHistory`), copied as it comes. It also runs by itself when a roll ends, while the log is on. |
| `/ip paste` | Opens a paste box and checks how much text the client accepts. |
| `/ip probe` | Records client version, which APIs and events exist, loot method and available methods, name forms, group, addons. |
| `/ip log on\|off\|clear` | Records loot windows (with the creature id, the loot threshold and the form of each master-loot candidate's name under its number), the Master Looter list and confirm events, rolls, trades (with the items in the trade window), boss, group and restriction events, and the game's own messages about loot, trading, binding and groups. |
| `/ip msg [text]` | Sends a test addon message to the raid, party or guild and records the result code; received test messages are recorded too. |
| `/ip whisper First Surname [text]` | The same as a whisper to a full name. |
| `/ip run [label]` | Names this test run; the label and the addon version are saved in the file. |
| `/ip show` | Summary, including addon messages received so far by prefix. |
| `/ip ej` | Dumps the Encounter Journal (needs a character of about level 16). |
| `/ip invite First Surname` | Tests whether an addon may invite a player. |

The event log stays on after a `/reload` (it is remembered in the saved file) until `/ip log off`.

The step-by-step pages for test rounds stay with the loot owner, because they name the players who ran them. `Items.lua` is generated: `python3 tools/make-probe-items.py` (from `addon/`) rewrites it from this repository's `data/loot/*.json`.

Test round: install on two clients, `/reload`, `/ip run <label>`, `/ip log on`, run the commands, `/reload`, then read `WTF/Account/<account>/SavedVariables/IntrepidProbe.lua`. Keep RCLootCouncil Classic disabled on a test client: it interfered with addon-message receiving in one observed round (not proven).
