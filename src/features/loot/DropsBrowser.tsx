import { useEffect, useState } from 'react'
import { deleteLootPriority, saveGuildRecord } from '../../guildApi'
import { lootCaptureItemIds } from '../../shared/game/lootTables'
import { peekItem, requestItem, retryItem, useItemInfoVersion } from '../../shared/lib/itemInfo'
import type { TabContext } from '../../shared/tabs/types'
import { ItemTooltip } from '../../shared/ui/ItemTooltip'
import { dropTables } from './dropTables'
import { countItems, dropEncounter, dropPriorityId, dropPriorityRecord, filterGroups, kindLabels, prioritiesForItem, type DropPick } from './dropsFilter'
import './Drops.css'

// Which creature drops which item, for the dungeons captured in data/loot. A zone picker, a search box, one card per creature and the
// items that drop from any creature in the zone. Names, icons and tooltips are read live by item id.
//
// Guild and Raid Leaders get a tick box on every item. A ticked box means "this item is on the priority list": ticking one that is not
// on the list marks it to be added (a priority with its item id, dungeon and creature and an empty candidate list, "Needs players"), and
// unticking one that is on the list marks it to be removed. Nothing changes until the bar at the bottom is used, so a whole zone can
// be added or taken off ("Add all", "Remove all") and checked first. Removing an item whose priority has players assigned asks once
// more, because that order is lost. There is one priority per item, so an item that is on the list cannot be added twice.
export function DropsBrowser({ live }: { live: TabContext }) {
  const [zoneId, setZoneId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<Map<number, DropPick>>(new Map())
  const [removing, setRemoving] = useState<Set<number>>(new Set())
  const [confirming, setConfirming] = useState(false)
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
  const allGroups = filterGroups(table, '', nameOf)

  // The priorities that stand for an item. It is on the list when there is one. Only an item whose name is known can be added, because
  // the name is stored on the priority.
  const listedBy = (id: number) => prioritiesForItem(live.data.priorities, id, nameOf(id))
  const isListed = (id: number) => listedBy(id).length > 0
  const canTick = (id: number) => canAdd && !isListed(id) && nameOf(id) !== undefined

  const pickFor = (group: { kind: string; name: string; npcId?: number }, itemId: number): DropPick => ({
    itemId, zoneId: table.zoneId, encounter: dropEncounter(table.name, group), ...(group.npcId !== undefined ? { npcId: group.npcId } : {}),
  })
  const changed = () => setConfirming(false)
  const toggleItem = (id: number, pick: DropPick) => {
    changed()
    if (isListed(id)) setRemoving((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next })
    else setAdding((current) => { const next = new Map(current); if (!next.delete(id)) next.set(id, pick); return next })
  }
  const toggleGroup = (group: (typeof groups)[number]) => {
    changed()
    setAdding((current) => {
      const next = new Map(current)
      const ids = group.itemIds.filter(canTick)
      if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id))
      else ids.forEach((id) => next.set(id, pickFor(group, id)))
      return next
    })
  }

  // The whole zone, whatever the search shows: every creature and the zone-wide items.
  const addableInZone = allGroups.flatMap((group) => group.itemIds.filter(canTick).map((id) => pickFor(group, id)))
  const listedInZone = lootCaptureItemIds(table).filter(isListed)
  const addAll = () => { changed(); setAdding((current) => new Map([...current, ...addableInZone.map((pick) => [pick.itemId, pick] as const)])) }
  const removeAll = () => { changed(); setRemoving((current) => new Set([...current, ...listedInZone])) }
  const clearChanges = () => { changed(); setAdding(new Map()); setRemoving(new Set()) }

  // What the bar at the bottom will do. An item that changed on the list in the meantime (someone else added or removed it) is left out.
  const toAdd = [...adding.values()].filter((pick) => !isListed(pick.itemId))
  const toRemove = [...removing].filter(isListed)
  const losing = toRemove.filter((id) => listedBy(id).some((priority) => priority.rankedPlayers.length > 0))
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

  async function applyChanges(confirmed: boolean) {
    if (!toAdd.length && !toRemove.length) { clearChanges(); return }
    if (losing.length && !confirmed) { setConfirming(true); return }
    setBusy(true)
    let added = 0
    let removed = 0
    try {
      for (const pick of toAdd) {
        await saveGuildRecord('lootPriorities', dropPriorityId(pick.itemId), dropPriorityRecord(pick, nameOf(pick.itemId) ?? `Item ${pick.itemId}`))
        added++
        setAdding((current) => { const next = new Map(current); next.delete(pick.itemId); return next })
      }
      for (const id of toRemove) {
        for (const priority of listedBy(id)) await deleteLootPriority(priority.id)
        removed++
        setRemoving((current) => { const next = new Set(current); next.delete(id); return next })
      }
      setMutationError('')
      const parts = [added ? `${plural(added, 'item', 'items')} added to Loot priorities` : '', removed ? `${plural(removed, 'item', 'items')} removed` : ''].filter(Boolean)
      setNotice(`${parts.join(', ')}.${added ? ' Assign players to each new one.' : ''}`)
    } catch (error) {
      setMutationError(`${added || removed ? `${added} added and ${removed} removed, then it stopped: ` : ''}${error instanceof Error ? error.message : 'Could not update Loot priorities.'}`)
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return <div className="drops-browser">
    <div className="drops-controls">
      <select className="drops-zone-select" aria-label="Zone" value={table.zoneId} onChange={(event) => setZoneId(Number(event.target.value))}>
        {dropTables.map((candidate) => <option key={candidate.zoneId} value={candidate.zoneId}>{candidate.name}</option>)}
      </select>
      <input className="drops-search" type="search" aria-label="Find a creature or an item" placeholder="Find a creature or an item..." value={query} onChange={(event) => setQuery(event.target.value)} />
    </div>
    {canAdd && <div className="drops-bulk">
      <button type="button" className="button button-secondary" onClick={addAll} disabled={busy || addableInZone.length === 0} title={addableInZone.length ? `Mark every item of ${table.name} that is not on the list yet` : `Everything in ${table.name} is on the list`}>Add all ({addableInZone.length})</button>
      <button type="button" className="button button-secondary" onClick={removeAll} disabled={busy || listedInZone.length === 0} title={listedInZone.length ? `Mark every item of ${table.name} that is on the list for removal` : `Nothing in ${table.name} is on the list`}>Remove all ({listedInZone.length})</button>
    </div>}
    <div className="drops-intro">
      <p><strong>{table.name}</strong>: {table.players}-player {table.kind}. Read from <a href={table.source} target="_blank" rel="noreferrer">Wowhead Forever</a> on {table.capturedAt}. Item names and tooltips are looked up live; point at an item, or select it, to read its tooltip.{canAdd && ' A ticked item is on the priority list: tick one to add it, untick one that is on the list to take it off, then use the bar at the bottom.'}</p>
      {table.dataStatus && <p className="drops-status">{table.dataStatus}</p>}
      {table.notes && table.notes.length > 0 && <details className="drops-notes"><summary>About this data</summary><ul>{table.notes.map((note) => <li key={note}>{note}</li>)}</ul></details>}
    </div>
    {groups.length === 0 && <p className="drops-empty">Nothing here matches "{query.trim()}".</p>}
    {groups.map((group) => {
      const addable = group.itemIds.filter(canTick)
      const allTicked = addable.length > 0 && addable.every((id) => adding.has(id))
      return <section key={group.key} className={`drops-group drops-${group.kind}`}>
        <header>
          <h3>{group.name}</h3>
          <span className="drops-kind">{kindLabels[group.kind]}</span>
          {group.npcId !== undefined && <span className="drops-npc">NPC {group.npcId}</span>}
          {addable.length > 0 && <button type="button" className="drops-select-all" onClick={() => toggleGroup(group)} disabled={busy}>{allTicked ? 'Clear these' : `Tick all (${addable.length})`}</button>}
        </header>
        <ul>{group.itemIds.map((id) => {
          const listed = isListed(id)
          const leaving = removing.has(id)
          return <li key={id} className="drops-item">
            {canAdd && (listed || canTick(id)) && <input type="checkbox" className="drops-tick" checked={listed ? !leaving : adding.has(id)} disabled={busy} onChange={() => toggleItem(id, pickFor(group, id))} aria-label={listed ? `Keep ${nameOf(id) ?? `item ${id}`} on the priority list` : `Add ${nameOf(id)} to the priority list`} />}
            <ItemTooltip itemId={id} />
            {listed && (leaving ? <span className="drops-leaving">Will be removed</span> : <span className="drops-listed">On the list</span>)}
          </li>
        })}</ul>
      </section>
    })}
    <p className="drops-count">Showing <strong>{countItems(groups)}</strong> of <strong>{lootCaptureItemIds(table).length}</strong> items in {table.name}.</p>
    {(toAdd.length > 0 || toRemove.length > 0) && <div className="drops-tray" role="region" aria-label="Changes to the priority list">
      {confirming
        ? <span className="drops-warning" role="alert">{plural(losing.length, 'item you are removing has', 'items you are removing have')} players assigned, and that order will be lost.</span>
        : <span>{[toAdd.length ? `${toAdd.length} to add` : '', toRemove.length ? `${toRemove.length} to remove` : ''].filter(Boolean).join(', ')}</span>}
      {confirming
        ? <button type="button" className="button button-secondary" onClick={() => setConfirming(false)} disabled={busy}>Back</button>
        : <button type="button" className="button button-secondary" onClick={clearChanges} disabled={busy}>Clear</button>}
      <button type="button" className={confirming ? 'button button-danger' : 'button button-primary'} onClick={() => applyChanges(confirming)} disabled={busy}>
        {confirming ? 'Yes, update the list' : toAdd.length && toRemove.length ? 'Update the list' : toRemove.length ? 'Remove from priorities' : 'Add to priorities'}
      </button>
    </div>}
  </div>
}
