import { checkLootCapture, type LootTableCapture } from '../../shared/game/lootTables'

// The drop lists (loot table captures) in data/loot/, bundled into the app. Item names, icons and tooltips are not in them: they are read live by
// item id. A file that fails the shared validator is skipped and named in the console, so a bad capture cannot break the tab.
const files = import.meta.glob('../../../data/loot/*.json', { eager: true, import: 'default' })

export const dropTables: LootTableCapture[] = Object.entries(files)
  .flatMap(([path, data]) => {
    const result = checkLootCapture(data)
    if (result.ok) return [result.table]
    console.warn(`Loot table ${path} was skipped:`, result.errors)
    return []
  })
  .sort((a, b) => a.name.localeCompare(b.name))
