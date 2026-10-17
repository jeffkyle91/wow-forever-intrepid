# Loot table captures

One JSON file per dungeon or raid: which creatures drop which items. A capture holds **item ids and creature names only**. Item names, icons and tooltips are fetched live by item id from `https://nether.wowhead.com/tooltip/item/{id}?dataEnv=16&locale=0`, so nothing here goes stale when a name changes.

These files are the starter data for the app's drop lists (Browse drops). Guild and Raid Leaders add to, hide from and extend them in the app (**Edit the drop lists**); those changes are stored in Firestore on top of these files, one phase at a time (a phase nobody changed has the lists of the phase before it), and never rewrite them, so a recapture of a file still applies to everything the guild has not changed. The format is validated by `src/shared/game/lootTables.ts`, the same code the app will use to preview an import.

## Format (version 1)

| Field | Meaning |
| --- | --- |
| `format` | Always `1`. |
| `zoneId`, `name`, `kind`, `players` | The Wowhead Forever zone id, its name, `dungeon` or `raid`, and the group size. |
| `source`, `capturedAt` | The page it was read from, and the date (`2026-10-16`). |
| `dataStatus`, `notes` | Optional free text: for example that the data is from the beta. |
| `sources` | The creatures: `npcId` (the number in the creature GUID the game gives an addon when loot opens), `name`, `kind` (`boss`, `rare` or `trash`) and `itemIds`. |
| `zoneWideItemIds` | Items that drop from any creature in the zone. May be empty. |
| `fromPhase` | Optional. The first loot phase the zone is in the lists of (default 0, every phase). A raid captured early can be kept out of the phases before it unlocks; the guild's leaders can still put it into a phase from the drop list editor. |

An item may appear once in the whole file. Wowhead does not flag bosses, so `kind` is a person's reading and may be corrected.

## Capture a dungeon

1. Open the dungeon's page on Wowhead Forever in your browser (list of zones: `https://www.wowhead.com/forever/zones`). Its **Drops** tab lists every item with the creature it comes from. Open one zone page at a time and leave a minute or so between pages: after about ten page loads in a few seconds Wowhead's CDN answered every page with a 403 "request blocked" error (the item check below uses a different endpoint and was not affected).
2. Write the file by hand or from what you read: one entry per creature, with its NPC id and item ids. Copy `the-deadmines.json` as a template.
3. Check it: `npm run check:loot -- data/loot/your-file.json`. It validates the shape, then looks every id up and reports any that Wowhead does not know. Add `--names` to read the names by creature and confirm they match what you saw.

## Check again later

The beta data will change at launch and when raids unlock.

- Before the change: `npm run check:loot -- data/loot/the-deadmines.json --save names.json` (keep `names.json` out of the repository).
- After it: `npm run check:loot -- data/loot/the-deadmines.json --compare names.json` lists items that were renamed or vanished.
