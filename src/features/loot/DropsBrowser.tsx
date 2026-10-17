import { useEffect, useState } from 'react'
import { saveGuildRecord } from '../../guildApi'
import { lootCaptureItemIds } from '../../shared/game/lootTables'
import { peekItem, requestItem, retryItem, useItemInfoVersion } from '../../shared/lib/itemInfo'
import type { TabContext } from '../../shared/tabs/types'
import { ItemTooltip } from '../../shared/ui/ItemTooltip'
import { nameKey } from './completion'
import { dropTables } from './dropTables'
import { countItems, dropEncounter, dropPriorityId, dropPriorityRecord, filterGroups, kindLabels, type DropPick } from './dropsFilter'
import './Drops.css'

// Which creature drops which item, for the dungeons captured in data/loot. A zone picker, a search box, one card per creature and the
// items that drop from any creature in the zone. Names, icons and tooltips are read live by item id. Guild and Raid Leaders can tick
// items (or all of a creature's items) and add them to Loot priorities: each becomes a priority with its item id, dungeon and
// creature and an empty candidate list ("Needs players"). There is one priority per item, so an item that is already listed
// is marked and cannot be ticked again.
export function DropsBrowser({ live }: { live: TabContext }) {
  const [zoneId, setZoneId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [ticked, setTicked] = useState<Map<number, DropPick>>(new Map())
  useItemInfoVersion() // so that the list filters again when item names arrive
  const table = dropTables.find((candidate) => candidate.zoneId === zoneId) ?? dropTables[0]
  const { busy, setBusy, setMutationError, setNotice } = live.feedback
  const canAdd = live.identity.canEditRaidData

  // Look up every item of the zone, not only the ones on screen, so that searching by item name finds them. An item whose lookup
  // failed earlier (for example in an outage) is tried again when the zone is opened.
  useEffect(() => { if (table) lootCaptureItemIds(table).forEach((id) => { retryItem(id); requestItem(id) }) }, [table])

  if (!table) return <p className="drops-empty">No drop lists are installed.</p>
  const nameOf = (id: number) => { const state = peekItem(id); return state?.status === 'ready' ? state.info.name : undefined }
  const groups = filterGroups(table, query, nameOf)

  // An item is listed when a priority has its id, or (for one typed by hand) the same name.
  const listedIds = new Set(live.data.priorities.flatMap((priority) => (priority.itemId ? [priority.itemId] : [])))
  const listedNames = new Set(live.data.priorities.map((priority) => nameKey(priority.item)))
  const isListed = (id: number) => listedIds.has(id) || (nameOf(id) !== undefined && listedNames.has(nameKey(nameOf(id) as string)))
  // Only an item whose name is known can be added, because the name is stored on the priority.
  const canTick = (id: number) => canAdd && !isListed(id) && nameOf(id) !== undefined

  const pickFor = (group: { kind: string; name: string; npcId?: number }, itemId: number): DropPick => ({
    itemId, zoneId: table.zoneId, encounter: dropEncounter(table.name, group), ...(group.npcId !== undefined ? { npcId: group.npcId } : {}),
  })
  const toggle = (pick: DropPick) => setTicked((current) => { const next = new Map(current); if (!next.delete(pick.itemId)) next.set(pick.itemId, pick); return next })
  const toggleGroup = (group: (typeof groups)[number]) => setTicked((current) => {
    const next = new Map(current)
    const ids = group.itemIds.filter(canTick)
    if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id))
    else ids.forEach((id) => next.set(id, pickFor(group, id)))
    return next
  })

  async function addTicked() {
    const picks = [...ticked.values()].filter((pick) => !isListed(pick.itemId))
    if (!picks.length) { setTicked(new Map()); return }
    setBusy(true)
    let added = 0
    try {
      for (const pick of picks) {
        await saveGuildRecord('lootPriorities', dropPriorityId(pick.itemId), dropPriorityRecord(pick, nameOf(pick.itemId) ?? `Item ${pick.itemId}`))
        added++
        setTicked((current) => { const next = new Map(current); next.delete(pick.itemId); return next })
      }
      setMutationError('')
      setNotice(`${added} ${added === 1 ? 'item' : 'items'} added to Loot priorities. Assign players to each one.`)
    } catch (error) {
      setMutationError(`${added ? `${added} added, then it stopped: ` : ''}${error instanceof Error ? error.message : 'Could not add the items to Loot priorities.'}`)
    } finally {
      setBusy(false)
    }
  }

  return <div className="drops-browser">
    <div className="drops-controls">
      <select className="drops-zone-select" aria-label="Zone" value={table.zoneId} onChange={(event) => setZoneId(Number(event.target.value))}>
        {dropTables.map((candidate) => <option key={candidate.zoneId} value={candidate.zoneId}>{candidate.name}</option>)}
      </select>
      <input className="drops-search" type="search" aria-label="Find a creature or an item" placeholder="Find a creature or an item..." value={query} onChange={(event) => setQuery(event.target.value)} />
    </div>
    <div className="drops-intro">
      <p><strong>{table.name}</strong>: {table.players}-player {table.kind}. Read from <a href={table.source} target="_blank" rel="noreferrer">Wowhead Forever</a> on {table.capturedAt}. Item names and tooltips are looked up live; point at an item, or select it, to read its tooltip.{canAdd && ' Tick the items that should go on the priority list, then add them.'}</p>
      {table.dataStatus && <p className="drops-status">{table.dataStatus}</p>}
      {table.notes && table.notes.length > 0 && <details className="drops-notes"><summary>About this data</summary><ul>{table.notes.map((note) => <li key={note}>{note}</li>)}</ul></details>}
    </div>
    {groups.length === 0 && <p className="drops-empty">Nothing here matches "{query.trim()}".</p>}
    {groups.map((group) => {
      const addable = group.itemIds.filter(canTick)
      const allTicked = addable.length > 0 && addable.every((id) => ticked.has(id))
      return <section key={group.key} className={`drops-group drops-${group.kind}`}>
        <header>
          <h3>{group.name}</h3>
          <span className="drops-kind">{kindLabels[group.kind]}</span>
          {group.npcId !== undefined && <span className="drops-npc">NPC {group.npcId}</span>}
          {addable.length > 0 && <button type="button" className="drops-select-all" onClick={() => toggleGroup(group)} disabled={busy}>{allTicked ? 'Clear these' : `Tick all (${addable.length})`}</button>}
        </header>
        <ul>{group.itemIds.map((id) => <li key={id} className="drops-item">
          {canTick(id) && <input type="checkbox" className="drops-tick" checked={ticked.has(id)} disabled={busy} onChange={() => toggle(pickFor(group, id))} aria-label={`Add ${nameOf(id)} to the priority list`} />}
          <ItemTooltip itemId={id} />
          {isListed(id) && <span className="drops-listed">On the list</span>}
        </li>)}</ul>
      </section>
    })}
    <p className="drops-count">Showing <strong>{countItems(groups)}</strong> of <strong>{lootCaptureItemIds(table).length}</strong> items in {table.name}.</p>
    {ticked.size > 0 && <div className="drops-tray" role="region" aria-label="Items to add">
      <span><strong>{ticked.size}</strong> {ticked.size === 1 ? 'item' : 'items'} ticked</span>
      <button type="button" className="button button-secondary" onClick={() => setTicked(new Map())} disabled={busy}>Clear</button>
      <button type="button" className="button button-primary" onClick={addTicked} disabled={busy}>Add to priorities</button>
    </div>}
  </div>
}
