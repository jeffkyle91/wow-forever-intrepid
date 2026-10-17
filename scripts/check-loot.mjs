// Checks a loot table capture (data/loot/*.json): the file's shape, then every item id against Wowhead's tooltip endpoint.
//
//   node scripts/check-loot.mjs data/loot/the-deadmines.json              validate and look up every id
//   node scripts/check-loot.mjs data/loot/the-deadmines.json --offline    validate only, no network
//   node scripts/check-loot.mjs data/loot/the-deadmines.json --names      also print each item's name and quality by boss
//   node scripts/check-loot.mjs <file> --save names.json                  write id -> name and quality (keep it out of the repo)
//   node scripts/check-loot.mjs <file> --compare names.json               list items that changed or disappeared since --save
//
// Run it again after the beta ends and in launch week: items that vanished or were renamed show up as differences.
// It only calls the public tooltip endpoint that Wowhead's own item tooltips use, a few at a time, never the website pages.
import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { checkLootCapture, lootCaptureItemIds } from '../src/shared/game/lootTables.ts'

const TOOLTIP = (id) => `https://nether.wowhead.com/tooltip/item/${id}?dataEnv=16&locale=0`
const QUALITIES = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']

const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: { offline: { type: 'boolean' }, names: { type: 'boolean' }, save: { type: 'string' }, compare: { type: 'string' }, help: { type: 'boolean' } } })
if (values.help || positionals.length !== 1) {
  console.log('Usage: node scripts/check-loot.mjs <capture.json> [--offline] [--names] [--save file] [--compare file]')
  process.exit(values.help ? 0 : 1)
}

const result = checkLootCapture(JSON.parse(await readFile(positionals[0], 'utf8')))
if (!result.ok) {
  console.error(`${positionals[0]} has problems:\n- ${result.errors.join('\n- ')}`)
  process.exit(1)
}
const { table } = result
const ids = lootCaptureItemIds(table)
console.log(`${table.name}: ${table.sources.length} sources, ${ids.length} distinct items. The file is valid.`)
if (values.offline) process.exit(0)

async function lookup(id) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(TOOLTIP(id), { signal: AbortSignal.timeout(15000) })
      if (response.ok) { const body = await response.json(); return typeof body.name === 'string' ? { name: body.name, quality: body.quality } : { error: 'no name in the answer' } }
      if (response.status !== 429 && response.status < 500) return { error: `HTTP ${response.status}` }
    } catch (error) { if (attempt === 1) return { error: error instanceof Error ? error.message : String(error) } }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return { error: 'no answer' }
}

const found = new Map()
for (let start = 0; start < ids.length; start += 4) {
  await Promise.all(ids.slice(start, start + 4).map(async (id) => found.set(id, await lookup(id))))
  await new Promise((resolve) => setTimeout(resolve, 150))
}
const failed = ids.filter((id) => found.get(id).error)
console.log(`Looked up ${ids.length - failed.length} of ${ids.length} items.`)
for (const id of failed) console.error(`  item ${id}: ${found.get(id).error}`)

if (values.names) {
  const label = (id) => { const item = found.get(id); return item.error ? `${id} (not found)` : `${id} ${item.name} [${QUALITIES[item.quality] ?? item.quality}]` }
  for (const source of table.sources) console.log(`\n${source.name} (${source.kind}, npc ${source.npcId})\n${source.itemIds.map((id) => `  ${label(id)}`).join('\n')}`)
  if (table.zoneWideItemIds.length) console.log(`\nAny creature in the zone\n${table.zoneWideItemIds.map((id) => `  ${label(id)}`).join('\n')}`)
}
if (values.save) {
  await writeFile(values.save, JSON.stringify(Object.fromEntries(ids.filter((id) => !found.get(id).error).map((id) => [id, found.get(id)])), null, 2) + '\n')
  console.log(`Saved names to ${values.save}.`)
}
let differences = 0
if (values.compare) {
  const before = JSON.parse(await readFile(values.compare, 'utf8'))
  for (const id of ids) {
    const old = before[id], now = found.get(id)
    if (!old) { console.log(`  new since the saved file: ${id}`); differences++ }
    else if (now.error) { console.log(`  gone: ${id} ${old.name}`); differences++ }
    else if (old.name !== now.name || old.quality !== now.quality) { console.log(`  changed: ${id} ${old.name} -> ${now.name}`); differences++ }
  }
  console.log(differences ? `${differences} difference(s) since ${values.compare}.` : `No differences since ${values.compare}.`)
}
process.exit(failed.length || differences ? 1 : 0)
