# In-game addon work

This folder holds the in-game (Lua) addon work for the Raid Desk. It is not part of the web build: `npm run build` and `npm run lint` do not touch it. The plan and findings are in `docs/design/loot-addon.md`.

## IntrepidProbe

A developer tool, version 0.5. It only reads and records what the client offers and what happens when loot drops. It changes nothing in the game and sends nothing over the internet. Everything it records stays in its own saved-variables file.

### Install

1. Copy the `IntrepidProbe` folder into the beta's addons folder:
   - Mac: `/Applications/World of Warcraft/_classic_beta_/Interface/AddOns/`
   - Windows: `C:\Program Files (x86)\World of Warcraft\_classic_beta_\Interface\AddOns\`
2. Restart the game. On the character screen open **AddOns** and tick **Intrepid Probe**.
3. In game, type `/console scriptErrors 1` so Lua errors show in a popup.

A new version only needs `/reload`. A newly added addon folder needs a full restart.

### Commands

| Command | What it does |
| --- | --- |
| `/ip probe` | Records client version, which APIs and events exist, the loot method, available loot methods, the player's name forms, group, addons and API namespaces. |
| `/ip log on`, `/ip log off`, `/ip log clear` | Records loot windows (with the creature id), loot rolls, trades, boss events, group and restriction events. |
| `/ip msg [text]` | Sends a test addon message to the raid, party or guild and records the result code. Received test messages are recorded too. |
| `/ip whisper First Surname [text]` | The same, as a whisper to a full name. |
| `/ip show` | Summary, including addon messages received so far by prefix (any addon). |
| `/ip ej` | Dumps the in-game Encounter Journal (instances, bosses, loot) if the client fills it in. |
| `/ip invite First Surname` | Tests whether an addon may invite a player to the party. |

### Reading the results

The game writes `WTF/Account/<account>/SavedVariables/IntrepidProbe.lua` when you `/reload` or log out. Read it with any text editor. **It contains character and guild names. Do not commit it or paste it into an issue.** Report the facts instead.

### A test round with a second player

1. Both install the probe, `/reload`, `/ip probe`.
2. One invites the other. Stand next to each other, out of combat.
3. Both `/ip log on`, then `/ip msg hello`, then `/ip whisper First Surname hi` (the other's full name), then `/ip show`.
4. Fight a mob and send one more `/ip msg` during the fight.
5. The party leader sets the loot method to Master Looter (party menu), kills a mob and opens its loot.
6. Trade one grey item.
7. Both `/reload`.

## Licence note

This addon is our own code (MIT, like the repository). Do not copy code from RCLootCouncil (GPL-3.0) or Gargul (All Rights Reserved) into this folder.
