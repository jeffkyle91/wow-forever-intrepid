import { useState } from 'react'
import { createPriorities, deletePriorities, newPriorityId, type PriorityRecord } from '../../guildApi'
import { makeWho } from '../../shared/game/candidates'
import { lootCaptureItemIds } from '../../shared/game/lootTables'
import { phaseNoOf, phaseOptions, type PhaseOption } from '../../shared/game/phases'
import type { TabContext } from '../../shared/tabs/types'
import { ItemTooltip } from '../../shared/ui/ItemTooltip'
import { Modal } from '../../shared/ui/Modal'
import { awardsRecordedFrom } from './carried'
import { carryOverFields, onTargetList } from './carryOver'
import { listingProgress, priorityLookup } from './completion'
import { groupPriorities } from './groupPriorities'
import { useBossOrder, useDropTables } from './useDropTables'
import './Drops.css'
import './CarryOver.css'

// Bring items from an earlier phase into `target` (the phase being looked at: the current one, or the next one a leader is preparing). Each
// ticked item becomes a new priority there with the same item, boss, note and the whole candidate list; who already received it comes with it
// (the awards of the priority it came from count toward it) and who still needs it stays open. The earlier phase is never touched. Every
// new priority is written through the audited helpers, so it is in the Log.
export function CarryOverModal({ close, live, target }: { close: () => void; live: TabContext; target: PhaseOption }) {
  const { busy, setBusy, setMutationError, setNotice } = live.feedback
  const { settings, allPriorities, awards } = live.data
  const who = makeWho(live.data.roster)
  // Earlier phases that have something to carry, newest first.
  const sources = phaseOptions(settings, false).filter((option) => option.no < target.no && allPriorities.some((priority) => phaseNoOf(priority) === option.no))
  const [sourceNo, setSourceNo] = useState(sources[0]?.no ?? -1)
  const bossOrder = useBossOrder(live.data.lootTables, Math.max(0, sourceNo)) // the lists of the phase the items come from
  // The drop lists of the phase the items go to: an item or zone it does not have cannot be ticked off again in Browse drops (only in its last group).
  const targetItems = new Set(useDropTables(live.data.lootTables, target.no).flatMap(lootCaptureItemIds))
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // The item whose carried-over copy is being asked about (Remove, then Yes or Keep it).
  const [asking, setAsking] = useState<string | null>(null)

  const lookup = priorityLookup([...allPriorities, ...live.data.hiddenPriorities])
  // An item that was taken off the list of the target phase and kept is still there, so it cannot be carried over again.
  const targetList = [...allPriorities, ...live.data.hiddenPriorities].filter((priority) => phaseNoOf(priority) === target.no)
  const fromSource = allPriorities.filter((priority) => phaseNoOf(priority) === sourceNo)
  const text = query.trim().toLowerCase()
  const shown = fromSource.filter((priority) => !text || `${priority.item} ${priority.encounter} ${priority.rankedPlayers.join(' ')}`.toLowerCase().includes(text))
  const canPick = (priority: PriorityRecord) => !onTargetList(targetList, priority)
  const missing = (priority: PriorityRecord) => priority.itemId !== undefined && !targetItems.has(priority.itemId)
  const pickable = shown.filter((priority) => canPick(priority) && !missing(priority))
  const staged = fromSource.filter((priority) => picked.has(priority.id) && canPick(priority))
  const sourceName = sources.find((option) => option.no === sourceNo)?.name ?? ''

  // The copy of a source priority that this dialog carried over to the target phase earlier, if it is still on the list: the one that can be taken off again.
  const carriedCopy = (source: PriorityRecord) => allPriorities.find((priority) => phaseNoOf(priority) === target.no && priority.carriedFrom === source.id)

  async function removeCopy(copy: PriorityRecord) {
    setBusy(true)
    try {
      await deletePriorities([copy], { uid: live.identity.uid, displayName: live.identity.displayName })
      setMutationError('')
      setNotice(`${copy.item} was taken off ${target.name}'s list. It can be carried over again.`)
      setAsking(null)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not remove the item.')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) => setPicked((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next })
  const toggleAll = (list: PriorityRecord[]) => setPicked((current) => {
    const next = new Set(current)
    const ids = list.filter((priority) => canPick(priority) && !missing(priority)).map((priority) => priority.id)
    if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id))
    else ids.forEach((id) => next.add(id))
    return next
  })

  async function carryOver() {
    if (!staged.length) return
    setBusy(true)
    let written = 0
    try {
      await createPriorities(staged.map((priority) => ({ id: newPriorityId(), fields: carryOverFields(priority, target.no) })), { uid: live.identity.uid, displayName: live.identity.displayName }, (ids) => { written += ids.length })
      setMutationError('')
      setNotice(`${written} ${written === 1 ? 'item' : 'items'} carried over from ${sourceName} to ${target.name}.`)
      close()
    } catch (error) {
      setMutationError(`${written ? `${written} carried over, then it stopped: ` : ''}${error instanceof Error ? error.message : 'Could not carry the items over.'}`)
    } finally {
      setBusy(false)
    }
  }

  return <Modal title="Carry over" onClose={close}><div className="carry-over">
    {sources.length === 0 ? <p className="drops-empty">Nothing to carry over: no earlier phase has any priorities.</p> : <>
      <p className="carry-intro">Bring items from an earlier phase into <strong>{target.name}</strong>. Each one comes with its whole candidate list: players who already got it show as received, and the others stay on it. The earlier phase is not changed.</p>
      <div className="drops-controls">
        <select className="drops-zone-select phase-select" aria-label="Carry over from" value={sourceNo} onChange={(event) => { setSourceNo(Number(event.target.value)); setPicked(new Set()) }}>
          {sources.map((option) => <option key={option.no} value={option.no}>{option.kind === 'current' ? `${option.name} (current)` : option.name}</option>)}
        </select>
        <input className="drops-search" type="search" aria-label="Find an item or a player" placeholder="Find an item or a player..." value={query} onChange={(event) => setQuery(event.target.value)} />
        <button type="button" className="button button-secondary" onClick={() => toggleAll(pickable)} disabled={busy || pickable.length === 0}>{pickable.length > 0 && pickable.every((priority) => picked.has(priority.id)) ? 'Clear all' : `Tick all (${pickable.length})`}</button>
      </div>
      {shown.length === 0 && <p className="drops-empty">{fromSource.length === 0 ? `${sourceName} has no priorities.` : `Nothing here matches "${query.trim()}".`}</p>}
      {groupPriorities(shown, bossOrder).map((dungeon) => <div key={dungeon.key} className="carry-dungeon-group">
        <p className="carry-dungeon">{dungeon.dungeon || 'Other priorities'}</p>
        {dungeon.bosses.map((boss) => {
          const open = boss.priorities.filter((priority) => canPick(priority) && !missing(priority))
          return <section key={boss.key} className="drops-group drops-boss">
            <header>
              <h3>{boss.boss || 'No encounter noted'}</h3>
              {open.length > 0 && <button type="button" className="drops-select-all" onClick={() => toggleAll(boss.priorities)} disabled={busy}>{open.every((priority) => picked.has(priority.id)) ? 'Clear these' : `Tick all (${open.length})`}</button>}
            </header>
            <ul className="carry-list">{boss.priorities.map((priority) => {
              const progress = listingProgress(priority, awards, lookup, who)
              const received = progress.received.filter(Boolean).length
              const already = !canPick(priority)
              return <li key={priority.id} className="drops-item carry-item">
                {!already && <input type="checkbox" className="drops-tick" checked={picked.has(priority.id)} disabled={busy} onChange={() => toggle(priority.id)} aria-label={`Carry over ${priority.item}`} />}
                {priority.itemId ? <ItemTooltip itemId={priority.itemId} fallbackName={priority.item} /> : <span className="carry-name">{priority.item}</span>}
                <small className="carry-meta">{priority.rankedPlayers.length ? `${priority.rankedPlayers.length} listed, ${received} received` : 'nobody listed'}</small>
                {already && <span className="drops-listed">{carriedCopy(priority) ? 'Carried over' : 'On the list'}</span>}
                {already && carriedCopy(priority) && (asking === priority.id
                  ? <span className="carry-ask" role="alert">Take it off {target.name}'s list?{awardsRecordedFrom(carriedCopy(priority)!, awards) > 0 ? ` The ${awardsRecordedFrom(carriedCopy(priority)!, awards) === 1 ? 'award' : `${awardsRecordedFrom(carriedCopy(priority)!, awards)} awards`} recorded from it stay${awardsRecordedFrom(carriedCopy(priority)!, awards) === 1 ? 's' : ''} in the Log.` : ''}
                    <button type="button" className="button button-primary" onClick={() => void removeCopy(carriedCopy(priority)!)} disabled={busy}>Yes, remove it</button>
                    <button type="button" className="button button-secondary" onClick={() => setAsking(null)} disabled={busy}>Keep it</button></span>
                  : <button type="button" className="drops-select-all" onClick={() => setAsking(priority.id)} disabled={busy} title={`Carried over by mistake, or not needed in ${target.name}: take it off ${target.name}'s list again`} aria-label={`Remove ${priority.item} from ${target.name}`}>Remove</button>)}
                {!already && missing(priority) && <span className="drops-parked" title={`Its zone or item is not in ${target.name}'s drop lists. You can carry it over, but it will sit in the last group of Browse drops (On the list, but not in the drop lists) until it is taken off.`}>Not in {target.name}'s drop lists</span>}
              </li>
            })}</ul>
          </section>
        })}
      </div>)}
      {staged.length > 0 && <div className="drops-tray" role="region" aria-label="Items to carry over">
        <span>{staged.length} to carry over</span>
        <button type="button" className="button button-secondary" onClick={() => setPicked(new Set())} disabled={busy}>Clear</button>
        <button type="button" className="button button-primary" onClick={carryOver} disabled={busy}>Carry over to {target.name}</button>
      </div>}
    </>}
  </div></Modal>
}
