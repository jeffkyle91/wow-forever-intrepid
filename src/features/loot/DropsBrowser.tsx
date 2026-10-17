import { useEffect, useState } from 'react'
import { lootCaptureItemIds } from '../../shared/game/lootTables'
import { peekItem, requestItem, retryItem, useItemInfoVersion } from '../../shared/lib/itemInfo'
import { ItemTooltip } from '../../shared/ui/ItemTooltip'
import { dropTables } from './dropTables'
import { countItems, filterGroups, kindLabels } from './dropsFilter'
import './Drops.css'

// Which creature drops which item, for the dungeons captured in data/loot. A zone picker, a search box, one card per creature and the
// items that drop from any creature in the zone. Names, icons and tooltips are read live by item id.
export function DropsBrowser() {
  const [zoneId, setZoneId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  useItemInfoVersion() // so that the list filters again when item names arrive
  const table = dropTables.find((candidate) => candidate.zoneId === zoneId) ?? dropTables[0]

  // Look up every item of the zone, not only the ones on screen, so that searching by item name finds them. An item whose lookup
  // failed earlier (for example in an outage) is tried again when the zone is opened.
  useEffect(() => { if (table) lootCaptureItemIds(table).forEach((id) => { retryItem(id); requestItem(id) }) }, [table])

  if (!table) return <p className="drops-empty">No drop lists are installed.</p>
  const groups = filterGroups(table, query, (id) => { const state = peekItem(id); return state?.status === 'ready' ? state.info.name : undefined })
  return <div className="drops-browser">
    <div className="drops-controls">
      <select className="drops-zone-select" aria-label="Zone" value={table.zoneId} onChange={(event) => setZoneId(Number(event.target.value))}>
        {dropTables.map((candidate) => <option key={candidate.zoneId} value={candidate.zoneId}>{candidate.name}</option>)}
      </select>
      <input className="drops-search" type="search" aria-label="Find a creature or an item" placeholder="Find a creature or an item..." value={query} onChange={(event) => setQuery(event.target.value)} />
    </div>
    <div className="drops-intro">
      <p><strong>{table.name}</strong>: {table.players}-player {table.kind}. Read from <a href={table.source} target="_blank" rel="noreferrer">Wowhead Forever</a> on {table.capturedAt}. Item names and tooltips are looked up live; point at an item, or select it, to read its tooltip.</p>
      {table.dataStatus && <p className="drops-status">{table.dataStatus}</p>}
      {table.notes && table.notes.length > 0 && <details className="drops-notes"><summary>About this data</summary><ul>{table.notes.map((note) => <li key={note}>{note}</li>)}</ul></details>}
    </div>
    {groups.length === 0 && <p className="drops-empty">Nothing here matches "{query.trim()}".</p>}
    {groups.map((group) => <section key={group.key} className={`drops-group drops-${group.kind}`}>
      <header>
        <h3>{group.name}</h3>
        <span className="drops-kind">{kindLabels[group.kind]}</span>
        {group.npcId !== undefined && <span className="drops-npc">NPC {group.npcId}</span>}
      </header>
      <ul>{group.itemIds.map((id) => <li key={id}><ItemTooltip itemId={id} /></li>)}</ul>
    </section>)}
    <p className="drops-count">Showing <strong>{countItems(groups)}</strong> of <strong>{lootCaptureItemIds(table).length}</strong> items in {table.name}.</p>
  </div>
}
