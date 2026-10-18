import { useEffect, useState } from 'react'
import { createPriorities, deletePriorities, newPriorityId, setPrioritiesHidden } from '../../guildApi'
import { lootCaptureItemIds } from '../../shared/game/lootTables'
import { phaseLabel, phaseNoOf, phaseOptions } from '../../shared/game/phases'
import { peekItem, requestItem, retryItem, useItemInfoVersion } from '../../shared/lib/itemInfo'
import type { TabContext } from '../../shared/tabs/types'
import { ItemTooltip } from '../../shared/ui/ItemTooltip'
import { useDropTables } from './useDropTables'
import { countItems, dropEncounter, dropPriorityRecord, filterGroups, kindLabels, prioritiesForItem, type DropPick } from './dropsFilter'
import './Drops.css'

// Which creature drops which item, for the dungeons captured in data/loot. A phase picker, a zone picker, a search box, one card per creature and
// the items that drop from any creature in the zone. Names, icons and tooltips are read live by item id.
//
// Guild and Raid Leaders get a tick box on every item. A ticked box means "this item is on the priority list of the phase picked above": ticking
// one that is not on the list marks it to be added (a priority with its item id, dungeon and creature and an empty candidate list, "Needs players"),
// and unticking one that is on the list marks it to be taken off. Nothing changes until the bar at the bottom is used, so a whole zone can be added
// or taken off ("Add all", "Remove all") and checked first. Only the current phase and the next one can be changed (a finished phase is a record):
// everyone can look at a finished phase's lists, read-only. The drop lists themselves belong to a phase too (shared/game/guildTables.ts), so the zones
// and items shown are those of the phase picked here. Taking off an item that already has priorities asks once more, and **keeps them**: the priority is hidden, not deleted,
// with its candidates and the awards recorded from it, and ticking the item again brings it back as it was. There is one priority per item per phase.
// The phase picked is kept by the dialog (DropsModal), so the drop list editor opens on the phase being looked at.
export function DropsBrowser({ live, phaseNo, onPhaseNo }: { live: TabContext; phaseNo: number; onPhaseNo: (no: number) => void }) {
  const [zoneId, setZoneId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<Map<number, DropPick>>(new Map())
  const [removing, setRemoving] = useState<Set<number>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [typedAsk, setTypedAsk] = useState<string | null>(null)
  useItemInfoVersion() // so that the list filters again when item names arrive
  const { busy, setBusy, setMutationError, setNotice } = live.feedback
  const canAdd = live.identity.canEditRaidData
  // The phases whose lists can be looked at here: the current one, the finished ones, and for leaders the next one. Only the current phase and the
  // next one can be changed.
  const phases = phaseOptions(live.data.settings, canAdd)
  const selected = phases.find((option) => option.no === phaseNo) ?? phases.find((option) => option.kind === 'current') ?? phases[0]
  const editable = canAdd && selected.kind !== 'past'
  // The drop lists of the phase picked here: the built-in lists with the guild's own changes for that phase and the ones before it.
  const dropTables = useDropTables(live.data.lootTables, selected.no)
  const table = dropTables.find((candidate) => candidate.zoneId === zoneId) ?? dropTables[0]
  const phasePriorities = live.data.allPriorities.filter((priority) => phaseNoOf(priority) === selected.no)
  // Priorities of this phase that were taken off the list and kept.
  const parked = live.data.hiddenPriorities.filter((priority) => phaseNoOf(priority) === selected.no)

  // Look up every item of the zone, not only the ones on screen, so that searching by item name finds them. An item whose lookup
  // failed earlier (for example in an outage) is tried again when the zone is opened.
  useEffect(() => { if (table) lootCaptureItemIds(table).forEach((id) => { retryItem(id); requestItem(id) }) }, [table])

  const nameOf = (id: number) => { const state = peekItem(id); return state?.status === 'ready' ? state.info.name : undefined }
  const groups = table ? filterGroups(table, query, nameOf) : []
  const allGroups = table ? filterGroups(table, '', nameOf) : []
  // Priorities of this phase whose item is in none of the phase's drop lists (the zone or the item was taken out of the phase after they were made).
  // Browse drops is the way to take a priority off the list, so they are offered here too.
  const inLists = new Set(dropTables.flatMap(lootCaptureItemIds))
  const orphanIds = [...new Set(phasePriorities.flatMap((priority) => (priority.itemId !== undefined && !inLists.has(priority.itemId) ? [priority.itemId] : [])))]

  // The priorities that stand for an item. It is on the list when there is one. Only an item whose name is known can be added, because
  // the name is stored on the priority.
  const listedBy = (id: number) => prioritiesForItem(phasePriorities, id, nameOf(id))
  const isListed = (id: number) => listedBy(id).length > 0
  const parkedFor = (id: number) => prioritiesForItem(parked, id, nameOf(id))
  // An item that was taken off and kept can be put back without its name (it is on the priority already).
  const canTick = (id: number) => editable && !isListed(id) && (parkedFor(id).length > 0 || nameOf(id) !== undefined)
  const playersOf = (priorities: { rankedPlayers: string[] }[]) => Math.max(0, ...priorities.map((priority) => priority.rankedPlayers.length))
  const changePhase = (no: number) => { onPhaseNo(no); setAdding(new Map()); setRemoving(new Set()); setConfirming(false) }

  const pickFor = (group: { kind: string; name: string; npcId?: number }, itemId: number): DropPick => ({
    itemId, zoneId: table?.zoneId ?? 0, encounter: dropEncounter(table?.name ?? '', group), ...(group.npcId !== undefined ? { npcId: group.npcId } : {}),
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
  const listedInZone = table ? lootCaptureItemIds(table).filter(isListed) : []
  const addAll = () => { changed(); setAdding((current) => new Map([...current, ...addableInZone.map((pick) => [pick.itemId, pick] as const)])) }
  const removeAll = () => { changed(); setRemoving((current) => new Set([...current, ...listedInZone])) }
  const clearChanges = () => { changed(); setAdding(new Map()); setRemoving(new Set()) }

  // What the bar at the bottom will do. An item that changed on the list in the meantime (someone else added or removed it) is left out.
  const toAdd = [...adding.values()].filter((pick) => !isListed(pick.itemId))
  const toRemove = [...removing].filter(isListed)
  // Items being taken off that already have priorities: they are kept (hidden), after one more question.
  const withPriorities = toRemove.filter((id) => listedBy(id).some((priority) => priority.rankedPlayers.length > 0))
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  const namesOf = (ids: number[]) => ids.slice(0, 3).map((id) => nameOf(id) ?? `item ${id}`).join(', ') + (ids.length > 3 ? ` and ${ids.length - 3} more` : '')

  // Priorities typed by hand (before items came from the drop lists) carry no item number, so no tick box here can stand for them. They are listed in a group
  // of their own to be taken off: deleted, with the Log keeping what they said.
  const typed = phasePriorities.filter((priority) => priority.itemId === undefined)
  async function removeTyped(priority: (typeof typed)[number]) {
    setBusy(true)
    try {
      await deletePriorities([priority], { uid: live.identity.uid, displayName: live.identity.displayName })
      setMutationError('')
      setNotice(`${priority.item} was taken off ${selected.name}'s list.`)
      setTypedAsk(null)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not take the priority off.')
    } finally {
      setBusy(false)
    }
  }

  async function applyChanges(confirmed: boolean) {
    if (!toAdd.length && !toRemove.length) { clearChanges(); return }
    if (withPriorities.length && !confirmed) { setConfirming(true); return }
    setBusy(true)
    // Every change is logged in the Log, in batches (see createPriorities). What was written stays written if a later batch fails, so the counts
    // and the staged items follow what was actually written.
    const who = { uid: live.identity.uid, displayName: live.identity.displayName }
    const restores = toAdd.filter((pick) => parkedFor(pick.itemId).length > 0)
    const creates = toAdd.filter((pick) => parkedFor(pick.itemId).length === 0).map((pick) => ({ id: newPriorityId(), pick }))
    const leaving = toRemove.flatMap((id) => listedBy(id).map((priority) => ({ id, priority })))
    const keeping = leaving.filter(({ priority }) => priority.rankedPlayers.length > 0)
    const deleting = leaving.filter(({ priority }) => priority.rankedPlayers.length === 0)
    const done = new Set<string>()
    const sum = () => {
      const whole = (ids: number[], priorities: (itemId: number) => { id: string }[]) => ids.filter((id) => priorities(id).every((priority) => done.has(priority.id))).length
      return [
        creates.filter(({ id }) => done.has(id)).length ? `${plural(creates.filter(({ id }) => done.has(id)).length, 'item', 'items')} added` : '',
        whole(restores.map((pick) => pick.itemId), parkedFor) ? `${plural(whole(restores.map((pick) => pick.itemId), parkedFor), 'item', 'items')} put back, priorities restored` : '',
        whole(keeping.map(({ id }) => id), listedBy) ? `${plural(whole([...new Set(keeping.map(({ id }) => id))], listedBy), 'item', 'items')} taken off, priorities kept` : '',
        whole(deleting.map(({ id }) => id), listedBy) ? `${plural(whole([...new Set(deleting.map(({ id }) => id))], listedBy), 'item', 'items')} removed` : '',
      ].filter(Boolean)
    }
    const afterBatch = (ids: string[]) => {
      ids.forEach((id) => done.add(id))
      setAdding((current) => {
        const next = new Map(current)
        creates.filter(({ id }) => done.has(id)).forEach(({ pick }) => next.delete(pick.itemId))
        restores.filter((pick) => parkedFor(pick.itemId).every((priority) => done.has(priority.id))).forEach((pick) => next.delete(pick.itemId))
        return next
      })
      setRemoving((current) => {
        const next = new Set(current)
        toRemove.filter((id) => listedBy(id).every((priority) => done.has(priority.id))).forEach((id) => next.delete(id))
        return next
      })
    }
    try {
      await createPriorities(creates.map(({ id, pick }) => ({ id, fields: dropPriorityRecord(pick, nameOf(pick.itemId) ?? `Item ${pick.itemId}`, selected.no) })), who, afterBatch)
      await setPrioritiesHidden(restores.flatMap((pick) => parkedFor(pick.itemId)), false, who, afterBatch)
      await setPrioritiesHidden(keeping.map(({ priority }) => priority), true, who, afterBatch)
      await deletePriorities(deleting.map(({ priority }) => priority), who, afterBatch)
      setMutationError('')
      setNotice(`${selected.name}: ${sum().join(', ')}.${creates.length ? ' Assign players to each new one.' : ''}`)
    } catch (error) {
      const so_far = sum()
      setMutationError(`${so_far.length ? `${so_far.join(', ')}, then it stopped: ` : ''}${error instanceof Error ? error.message : 'Could not update Loot priorities.'}`)
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return <div className="drops-browser">
    <div className="drops-controls">
      {phases.length > 1 && <select className="drops-zone-select drops-phase-select phase-select" aria-label="Phase" value={selected.no} onChange={(event) => changePhase(Number(event.target.value))} disabled={busy}>
        {phases.map((option) => <option key={option.no} value={option.no}>{phaseLabel(option)}</option>)}
      </select>}
      {table && <select className="drops-zone-select" aria-label="Zone" value={table.zoneId} onChange={(event) => setZoneId(Number(event.target.value))}>
        {dropTables.map((candidate) => <option key={candidate.zoneId} value={candidate.zoneId}>{candidate.name}</option>)}
      </select>}
      <input className="drops-search" type="search" aria-label="Find a creature or an item" placeholder="Find a creature or an item..." value={query} onChange={(event) => setQuery(event.target.value)} />
    </div>
    {table && editable && <div className="drops-bulk">
      <button type="button" className="button button-secondary" onClick={addAll} disabled={busy || addableInZone.length === 0} title={addableInZone.length ? `Mark every item of ${table.name} that is not on the list yet` : `Everything in ${table.name} is on the list`}>Add all ({addableInZone.length})</button>
      <button type="button" className="button button-secondary" onClick={removeAll} disabled={busy || listedInZone.length === 0} title={listedInZone.length ? `Mark every item of ${table.name} that is on the list to be taken off` : `Nothing in ${table.name} is on the list`}>Remove all ({listedInZone.length})</button>
    </div>}
    {!table && <p className="drops-empty">{selected.name} has no zones in its drop lists{selected.kind === 'past' ? '. It is finished, so zones cannot be chosen for it any more.' : live.identity.canEditRaidData ? ' yet. Use Edit the drop lists to tick the zones it has, or to make it follow an earlier phase.' : ' yet. A leader chooses them.'}</p>}
    {table && <div className="drops-intro">
      <p><strong>{table.name}</strong>: {table.players}-player {table.kind}. {table.custom ? 'Added by the guild\u2019s leaders.' : <>Read from <a href={table.source} target="_blank" rel="noreferrer">Wowhead Forever</a> on {table.capturedAt}.{table.edited ? ' The guild\u2019s leaders have changed this list.' : ''}</>} Item names and tooltips are looked up live; point at an item, or select it, to read its tooltip.{editable ? ` You are changing the ${selected.name} list (a finished phase cannot be changed). A ticked item is on it: tick one to add it, untick one that is on it to take it off (an item that has priorities keeps them and gets them back when you tick it again), then use the bar at the bottom.` : selected.kind === 'past' ? ` These are the ${selected.name} lists as they stood: a finished phase cannot be changed.` : ` A ticked item is on the ${selected.name} priority list.`}</p>
      {table.dataStatus && <p className="drops-status">{table.dataStatus}</p>}
      {table.notes && table.notes.length > 0 && <details className="drops-notes"><summary>About this data</summary><ul>{table.notes.map((note) => <li key={note}>{note}</li>)}</ul></details>}
    </div>}
    {table && groups.length === 0 && <p className="drops-empty">Nothing here matches "{query.trim()}".</p>}
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
          const kept = parkedFor(id)
          const keptPlayers = playersOf(kept)
          const hasPlayers = playersOf(listedBy(id)) > 0
          return <li key={id} className="drops-item">
            {editable && (listed || canTick(id)) && <input type="checkbox" className="drops-tick" checked={listed ? !leaving : adding.has(id)} disabled={busy} onChange={() => toggleItem(id, pickFor(group, id))} aria-label={listed ? `Keep ${nameOf(id) ?? `item ${id}`} on the priority list` : kept.length ? `Put ${nameOf(id) ?? `item ${id}`} back on the priority list` : `Add ${nameOf(id)} to the priority list`} />}
            <ItemTooltip itemId={id} />
            {listed && (leaving ? <span className="drops-leaving">{hasPlayers ? 'Will be taken off (keeps its priorities)' : 'Will be removed'}</span> : <span className="drops-listed">On the list</span>)}
            {!listed && kept.length > 0 && (adding.has(id) ? <span className="drops-listed">Will be put back</span> : <span className="drops-parked" title="Taken off the list, with its priorities kept. Tick it to put it back as it was.">Taken off{keptPlayers ? `, keeps ${plural(keptPlayers, 'player', 'players')}` : ''}</span>)}
          </li>
        })}</ul>
      </section>
    })}
    {editable && orphanIds.length > 0 && <section className="drops-group drops-zone drops-orphans">
      <header>
        <h3>On the list, but not in {selected.name}'s drop lists</h3>
        <span className="drops-kind">no drop list</span>
      </header>
      <ul>{orphanIds.map((id) => {
        const leaving = removing.has(id)
        const hasPlayers = playersOf(listedBy(id)) > 0
        return <li key={id} className="drops-item">
          <input type="checkbox" className="drops-tick" checked={!leaving} disabled={busy} onChange={() => toggleItem(id, { itemId: id, zoneId: table?.zoneId ?? 0, encounter: '' })} aria-label={leaving ? `Put ${nameOf(id) ?? `item ${id}`} back on the priority list` : `Keep ${nameOf(id) ?? `item ${id}`} on the priority list`} />
          <ItemTooltip itemId={id} />
          {leaving ? <span className="drops-leaving">{hasPlayers ? 'Will be taken off (keeps its priorities)' : 'Will be removed'}</span> : <span className="drops-listed">On the list</span>}
        </li>
      })}</ul>
    </section>}
    {editable && typed.length > 0 && <section className="drops-group drops-zone drops-typed">
      <header>
        <h3>Typed by hand</h3>
        <span className="drops-kind">no drop item</span>
      </header>
      <p className="drops-typed-note">These priorities were typed in, so they are not tied to an item of the drop lists and have no tick box. Take one off here.</p>
      <ul>{typed.map((priority) => <li key={priority.id} className="drops-item">
        <span className="carry-name">{priority.item}</span>
        <small className="carry-meta">{priority.rankedPlayers.length ? `${priority.rankedPlayers.length} listed` : 'nobody listed'}</small>
        {typedAsk === priority.id
          ? <span className="drops-typed-ask" role="alert">Take it off{priority.rankedPlayers.length ? ` (its ${priority.rankedPlayers.length} listed ${priority.rankedPlayers.length === 1 ? 'candidate goes' : 'candidates go'} with it)` : ''}? The Log keeps what it said.
            <button type="button" className="button button-primary" onClick={() => void removeTyped(priority)} disabled={busy}>Yes, take it off</button>
            <button type="button" className="button button-secondary" onClick={() => setTypedAsk(null)} disabled={busy}>Keep it</button></span>
          : <button type="button" className="drops-select-all" onClick={() => setTypedAsk(priority.id)} disabled={busy} aria-label={`Take ${priority.item} off the list`}>Take off</button>}
      </li>)}</ul>
    </section>}
    {table && <p className="drops-count">Showing <strong>{countItems(groups)}</strong> of <strong>{lootCaptureItemIds(table).length}</strong> items in {table.name}.</p>}
    {(toAdd.length > 0 || toRemove.length > 0) && <div className="drops-tray" role="region" aria-label="Changes to the priority list">
      {confirming
        ? <span className="drops-warning" role="alert">{plural(withPriorities.length, 'item you are taking off already has', 'items you are taking off already have')} priorities set ({namesOf(withPriorities)}). {withPriorities.length === 1 ? 'It comes off the list but keeps its priorities, and comes back with them' : 'They come off the list but keep their priorities, and come back with them'} when you tick the item again.</span>
        : <span>{[toAdd.length ? `${toAdd.length} to add` : '', toRemove.length ? `${toRemove.length} to take off` : ''].filter(Boolean).join(', ')}</span>}
      {confirming
        ? <button type="button" className="button button-secondary" onClick={() => setConfirming(false)} disabled={busy}>Back</button>
        : <button type="button" className="button button-secondary" onClick={clearChanges} disabled={busy}>Clear</button>}
      <button type="button" className="button button-primary" onClick={() => applyChanges(confirming)} disabled={busy}>
        {confirming ? (toRemove.length === 1 ? 'Yes, take it off' : 'Yes, take them off') : toAdd.length && toRemove.length ? 'Update the list' : toRemove.length ? 'Take off the list' : 'Add to priorities'}
      </button>
    </div>}
  </div>
}
