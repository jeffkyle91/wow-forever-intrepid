# Loot table captures

One JSON file per dungeon or raid: which creatures drop which items. A capture holds **item ids and creature names only**. Item names, icons and tooltips are fetched live by item id from `https://nether.wowhead.com/tooltip/item/{id}?dataEnv=16&locale=0`, so nothing here goes stale when a name changes.

These files are the starter data for the loot tables planned for the app (priorities and awards pick from them; leaders will be able to edit and re-import them). The format is validated by `src/shared/game/lootTables.ts`, the same code the app will use to preview an import.

## Format (version 1)

| Field | Meaning |
| --- | --- |
| `format` | Always `1`. |
| `zoneId`, `name`, `kind`, `players` | The Wowhead Forever zone id, its name, `dungeon` or `raid`, and the group size. |
| `source`, `capturedAt` | The page it was read from, and the date (`2026-10-16`). |
| `dataStatus`, `notes` | Optional free text: for example that the data is from the beta. |
| `sources` | The creatures: `npcId` (the number in the creature GUID the game gives an addon when loot opens), `name`, `kind` (`boss`, `rare` or `trash`) and `itemIds`. |
| `zoneWideItemIds` | Items that drop from any creature in the zone. May be empty. |

An item may appear once in the whole file. Wowhead does not flag bosses, so `kind` is a person's reading and may be corrected.

## Capture a dungeon

1. Open the dungeon's page on Wowhead Forever in your browser (list of zones: `https://www.wowhead.com/forever/zones`). Its **Drops** tab lists every item with the creature it comes from.
2. Write the file by hand or from what you read: one entry per creature, with its NPC id and item ids. Copy `the-deadmines.json` as a template.
3. Check it: `npm run check:loot -- data/loot/your-file.json`. It validates the shape, then looks every id up and reports any that Wowhead does not know. Add `--names` to read the names by creature and confirm they match what you saw.

## Check again later

The beta data will change at launch and when raids unlock.

- Before the change: `npm run check:loot -- data/loot/the-deadmines.json --save names.json` (keep `names.json` out of the repository).
- After it: `npm run check:loot -- data/loot/the-deadmines.json --compare names.json` lists items that were renamed or vanished.
