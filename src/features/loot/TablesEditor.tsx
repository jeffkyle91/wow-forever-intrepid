import { useState } from 'react'
import { writeLootTables } from '../../guildApi'
import {
  GAME_ID_MAX, TABLE_ITEMS_MAX, TABLE_NAME_MAX, ZONE_WIDE_KEY, addCreature, addItems, addZone, editZone, hasText, itemHolders, moveCreature, parseItemIds, renameCreature, resetCreature, resetZone, restoreItem,
  setCreatureRemoved, setZoneInPhase, takeOffItem, type MergedSource, type MergedZone, type TableSourceKind, type TableWrite,
} from '../../shared/game/guildTables'
import { lootSourceKinds, type LootSourceKind } from '../../shared/game/lootTables'
import { phaseName, phaseOptions } from '../../shared/game/phases'
import { peekItem, useItemInfo, useItemInfoVersion } from '../../shared/lib/itemInfo'
import type { TabContext } from '../../shared/tabs/types'
import { ItemTooltip } from '../../shared/ui/ItemTooltip'
import { useMergedTables } from './useDropTables'
import './Tables.css'

// The editor for the drop lists of Browse drops (Guild and Raid Leaders). The lists belong to a PHASE: what is changed here is written for the phase
// picked at the top and applies from that phase on, so earlier phases keep what they had and a phase nobody changed has the lists of the one before it.
// The built-in lists are never changed; the guild's changes sit on top of them. Items can be added to a creature (by item number or Wowhead link, with the
// real name shown before anything is saved) and taken off again, creatures and whole zones can be added, moved, and taken out of a phase. Every change is
// a write with its entry in the Log (shared/game/guildTables.ts builds them, writeLootTables writes them). Nothing is deleted.
const sizes = [5, 10, 20, 25, 40]
const kindLabel = (kind: TableSourceKind) => (kind === 'zonewide' ? 'zone-wide' : kind)
const itemName = (id: number) => { const state = peekItem(id); return state?.status === 'ready' ? state.info.name : `item ${id}` }

type Who = { uid: string; displayName: string }
// `whyNot` is what to say when there is nothing to write (a builder answers nothing when a limit is reached or the thing is already so).
type Run = (writes: TableWrite[], done: string, whyNot?: string) => Promise<boolean>

// One pasted item number, looked up live, so a wrong number shows before it is saved.
function PastedItem({ id, heldBy }: { id: number; heldBy?: string }) {
  const state = useItemInfo(id)
  if (state?.status === 'error') return <li className="tables-pasted tables-bad"><span>{id}</span> {state.message}</li>
  return <li className={heldBy ? 'tables-pasted tables-held' : 'tables-pasted'}><ItemTooltip itemId={id} />{heldBy && <span> already on {heldBy}, so it stays there</span>}</li>
}

function AddItems({ zone, source, busy, run }: { zone: MergedZone; source: MergedSource; busy: boolean; run: Run }) {
  useItemInfoVersion() // so that a number Wowhead does not know blocks the button as soon as the answer arrives
  const [open, setOpen] = useState(false)
  const [pasted, setPasted] = useState('')
  const [unsure, setUnsure] = useState(false)
  const parsed = parseItemIds(pasted)
  const result = addItems(zone, source, parsed.ids)
  const holders = itemHolders(zone)
  const unknown = parsed.ids.filter((id) => { const state = peekItem(id); return state?.status === 'error' })
  const blocked = !result.write || result.tooMany || (unknown.length > 0 && !unsure)
  if (!open) return <button type="button" className="button button-secondary tables-small" onClick={() => setOpen(true)} disabled={busy}>Add items</button>
  return <div className="tables-add">
    <label>Item numbers or Wowhead links, one or several
      <textarea value={pasted} onChange={(event) => { setPasted(event.target.value); setUnsure(false) }} rows={2} placeholder="872, https://www.wowhead.com/forever/item=273804/..." aria-label={`Items to add to ${source.name}`} />
    </label>
    {parsed.ignored.length > 0 && <p className="tables-note">Could not read as an item: {parsed.ignored.join(', ')}</p>}
    {parsed.ids.length > 0 && <ul className="tables-preview">{parsed.ids.map((id) => <PastedItem key={id} id={id} heldBy={holders.get(id) && !source.hiddenItemIds.includes(id) ? holders.get(id) : undefined} />)}</ul>}
    {result.tooMany && <p className="tables-note tables-bad">A creature can add at most 80 items in one phase.</p>}
    {unknown.length > 0 && <label className="tables-confirm"><input type="checkbox" checked={unsure} onChange={(event) => setUnsure(event.target.checked)} /> Add the {unknown.length} number{unknown.length === 1 ? '' : 's'} Wowhead did not recognize anyway</label>}
    <div className="tables-row-actions">
      <button type="button" className="button button-secondary tables-small" onClick={() => { setOpen(false); setPasted(''); setUnsure(false) }} disabled={busy}>Cancel</button>
      <button type="button" className="button button-primary tables-small" disabled={busy || blocked}
        onClick={async () => { if (result.write && await run([result.write], `Added ${result.added.length} ${result.added.length === 1 ? 'item' : 'items'} to ${source.name}.`)) { setOpen(false); setPasted(''); setUnsure(false) } }}>
        {result.added.length ? `Add ${result.added.length} ${result.added.length === 1 ? 'item' : 'items'}` : 'Add'}
      </button>
    </div>
  </div>
}

function Creature({ zone, source, index, count, phase, previous, busy, run }: { zone: MergedZone; source: MergedSource; index: number; count: number; phase: string; previous: string; busy: boolean; run: Run }) {
  const wide = source.key === ZONE_WIDE_KEY
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(source.name)
  const [kind, setKind] = useState<TableSourceKind>(source.kind)
  const rename = renameCreature(zone, source, name, kind)
  const follow = resetCreature(zone, source)
  return <section className={`drops-group drops-${wide ? 'zone' : source.kind} tables-source${source.removed ? ' tables-removed' : ''}`}>
    <header>
      <h3>{source.name}</h3>
      <span className="drops-kind">{kindLabel(source.kind)}</span>
      {source.npcId !== undefined && <span className="drops-npc">NPC {source.npcId}</span>}
      {!wide && !source.builtIn && <span className="drops-kind tables-added">added by the guild</span>}
      {source.removed && <span className="drops-kind tables-added">out of {phase}</span>}
      {!wide && <span className="tables-actions">
        <button type="button" className="icon-button tables-move" aria-label={`Move ${source.name} earlier`} title="Move earlier" disabled={busy || index === 0 || source.removed} onClick={() => run(moveCreature(zone, source, -1), `${source.name} moved earlier.`, `${source.name} cannot move any earlier.`)}>{'\u2191'}</button>
        <button type="button" className="icon-button tables-move" aria-label={`Move ${source.name} later`} title="Move later" disabled={busy || index === count - 1 || source.removed} onClick={() => run(moveCreature(zone, source, 1), `${source.name} moved later.`, `${source.name} cannot move any later.`)}>{'\u2193'}</button>
        {!source.builtIn && <button type="button" className="button button-secondary tables-small" disabled={busy || source.removed} onClick={() => { setName(source.name); setKind(source.kind); setRenaming(!renaming) }}>Rename</button>}
        {!source.builtIn && !source.removed && <button type="button" className="button button-secondary tables-small" title={`Takes it out of ${phase} and the phases after it. Earlier phases keep it.`} disabled={busy} onClick={() => { const write = setCreatureRemoved(zone, source, true); if (write) void run([write], `${source.name} is out of ${phase} from here on.`) }}>Remove</button>}
        {!source.builtIn && source.removed && <button type="button" className="button button-secondary tables-small" disabled={busy} onClick={() => { const write = setCreatureRemoved(zone, source, false); if (write) void run([write], `${source.name} is back in ${phase}.`) }}>Bring back</button>}
        {follow && <button type="button" className="button button-secondary tables-small" title={`Takes away everything ${phase} says about it, so it follows ${previous || 'the earlier phase'} again.`} disabled={busy} onClick={() => void run([follow], `${source.name} follows ${previous || 'the earlier phase'} again.`)}>{previous ? `Follow ${previous}` : 'Follow the earlier phase'}</button>}
      </span>}
      {wide && follow && <span className="tables-actions"><button type="button" className="button button-secondary tables-small" disabled={busy} onClick={() => void run([follow], `The zone-wide list follows ${previous || 'the earlier phase'} again.`)}>{previous ? `Follow ${previous}` : 'Follow the earlier phase'}</button></span>}
    </header>
    {renaming && <div className="tables-add">
      <label>Name<input value={name} maxLength={TABLE_NAME_MAX} onChange={(event) => setName(event.target.value)} /></label>
      <label>Kind<select value={kind} onChange={(event) => setKind(event.target.value as TableSourceKind)}>{lootSourceKinds.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
      <div className="tables-row-actions">
        <button type="button" className="button button-secondary tables-small" onClick={() => setRenaming(false)} disabled={busy}>Cancel</button>
        <button type="button" className="button button-primary tables-small" disabled={busy || !rename} onClick={async () => { if (rename && await run([rename], `${source.name} renamed.`)) setRenaming(false) }}>Save</button>
      </div>
    </div>}
    <ul>
      {source.itemIds.map((id) => {
        const addedHere = source.addedItemIds.includes(id)
        return <li key={id} className={addedHere ? 'tables-item tables-item-added' : 'tables-item'}>
          <ItemTooltip itemId={id} />
          <button type="button" className="tables-chip-button" aria-label={`Take ${itemName(id)} off ${source.name}`} title={addedHere ? `Added in ${phase}. Take it back off.` : `Takes it off from ${phase} on. Earlier phases keep it.`} disabled={busy}
            onClick={() => { const write = takeOffItem(zone, source, id); void run(write ? [write] : [], `${itemName(id)} taken off ${source.name} from ${phase} on.`, `${itemName(id)} could not be taken off: ${phase} already takes the most items off one creature that it can (${TABLE_ITEMS_MAX}).`) }}>Take off</button>
        </li>
      })}
      {source.hiddenItemIds.map((id) => <li key={`hidden-${id}`} className="tables-item tables-item-hidden">
        <ItemTooltip itemId={id} />
        <button type="button" className="tables-chip-button" aria-label={`Bring ${itemName(id)} back to ${source.name}`} title={`Taken off in ${phase}. Bring it back.`} disabled={busy} onClick={() => { const write = restoreItem(zone, source, id); if (write) void run([write], `${itemName(id)} is back on ${source.name}.`) }}>Bring back</button>
      </li>)}
      {source.itemIds.length === 0 && source.hiddenItemIds.length === 0 && <li className="tables-empty">Nothing yet.</li>}
    </ul>
    {source.goneItemIds.length > 0 && !source.removed && <details className="tables-gone"><summary>Not in {phase} ({source.goneItemIds.length})</summary>
      <ul>{source.goneItemIds.map((id) => <li key={id} className="tables-item tables-item-hidden">
        <ItemTooltip itemId={id} />
        <button type="button" className="tables-chip-button" aria-label={`Add ${itemName(id)} back to ${source.name}`} title={`It was on ${source.name} in an earlier phase. Adds it back from ${phase} on.`} disabled={busy}
          onClick={() => { const result = addItems(zone, source, [id]); void run(result.write ? [result.write] : [], `${itemName(id)} is back on ${source.name} from ${phase} on.`, result.tooMany ? `${source.name} already adds the most items it can in ${phase} (${TABLE_ITEMS_MAX}).` : result.alreadyIn.length ? `${itemName(id)} is already on ${result.alreadyIn[0].where}, so it stays there.` : `${itemName(id)} could not be added back.`) }}>Add back</button>
      </li>)}</ul>
    </details>}
    {!source.removed && <div className="tables-foot"><AddItems zone={zone} source={source} busy={busy} run={run} /></div>}
  </section>
}

export function TablesEditor({ live, phaseNo, onPhaseNo }: { live: TabContext; phaseNo: number; onPhaseNo: (no: number) => void }) {
  const { settings } = live.data
  // Only the current phase and the next one can be written (a finished phase's lists are a record).
  const phases = phaseOptions(settings, true).filter((option) => option.kind !== 'past')
  const selected = phases.find((option) => option.no === phaseNo) ?? phases.find((option) => option.kind === 'current') ?? phases[0]
  const zones = useMergedTables(live.data.lootTables, selected.no)
  const [zoneId, setZoneId] = useState<number | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [newCreature, setNewCreature] = useState({ name: '', kind: 'boss' as LootSourceKind, npc: '' })
  const [newZone, setNewZone] = useState<{ name: string; kind: 'dungeon' | 'raid'; players: number } | null>(null)
  const [editingZone, setEditingZone] = useState<{ name: string; kind: 'dungeon' | 'raid'; players: number } | null>(null)
  const { busy, setBusy, setMutationError } = live.feedback
  const zone = zones.find((candidate) => candidate.zoneId === zoneId) ?? zones.find((candidate) => candidate.inPhase) ?? zones[0]
  const who: Who = { uid: live.identity.uid, displayName: live.identity.displayName }
  const phase = selected.name
  const before = selected.no > 0 ? phaseName(settings, selected.no - 1) : ''
  const next = selected.kind === 'current' ? phases.find((option) => option.kind === 'next') : undefined

  // One user action is one or a few audited writes. What was written stays written if a later one fails, and the lists follow what is stored.
  async function run(writes: TableWrite[], done: string, whyNot?: string): Promise<boolean> {
    if (!writes.length) { if (whyNot) setMessage({ text: whyNot, error: true }); return false }
    setBusy(true)
    try {
      await writeLootTables(writes, who)
      setMutationError('')
      setMessage({ text: done, error: false })
      return true
    } catch (error) {
      // The rules refuse a change made from an out-of-date view (two leaders at once, or a phase that started meanwhile) with a bare permission error.
      const stale = (error as { code?: string } | null)?.code === 'permission-denied'
      setMessage({ text: stale ? 'That change was refused. Someone may have changed the same thing a moment ago, or the phase may have just started or been reopened. Close this window, open it again and retry.' : error instanceof Error ? error.message : 'Could not change the drop list.', error: true })
      return false
    } finally {
      setBusy(false)
    }
  }

  const liveSources = zone ? zone.sources.filter((source) => !source.removed) : []
  const npc = newCreature.npc.trim()
  const npcValid = npc === '' || (/^\d{1,9}$/.test(npc) && Number(npc) > 0 && Number(npc) <= GAME_ID_MAX)
  const creatureReady = hasText(newCreature.name) && newCreature.name.length <= TABLE_NAME_MAX && npcValid
  const zoneFieldsReady = (fields: { name: string } | null) => !!fields && hasText(fields.name) && fields.name.length <= TABLE_NAME_MAX
  const zoneToggle = zone ? setZoneInPhase(zone, !zone.inPhase) : null
  const zoneFollow = zone ? resetZone(zone) : null

  return <div className="tables-editor">
    <div className="drops-controls">
      {phases.length > 1 && <select className="drops-zone-select drops-phase-select" aria-label="Phase to edit" value={selected.no} onChange={(event) => { onPhaseNo(Number(event.target.value)); setEditingZone(null); setNewZone(null); setMessage(null) }} disabled={busy}>
        {phases.map((option) => <option key={option.no} value={option.no}>{option.name} ({option.kind})</option>)}
      </select>}
      <select className="drops-zone-select" aria-label="Zone to edit" value={zone?.zoneId ?? ''} onChange={(event) => { setZoneId(Number(event.target.value)); setEditingZone(null) }}>
        {zones.map((candidate) => <option key={candidate.zoneId} value={candidate.zoneId}>{candidate.name}{candidate.custom ? ' (added by the guild)' : ''}{candidate.inPhase ? '' : ` (not in ${phase})`}</option>)}
      </select>
      <button type="button" className="button button-secondary" onClick={() => setNewZone(newZone ? null : { name: '', kind: 'raid', players: 40 })} disabled={busy}>Add a zone</button>
    </div>
    <p className="tables-intro">You are changing the drop lists of <strong>{phase}</strong>. {before ? (selected.kind === 'next' ? <>{phase} follows {before}: a change in {before} also reaches {phase}, unless {phase} changed the same item, creature or zone.</> : <>{phase} started from the lists of {before}, which is finished and cannot change.</>) : null} What you change here applies to {phase} and the phases after it, never to a finished phase. The built-in lists are not changed, every change is in the Log, and nothing is ever deleted. Find an item's number in the address of its Wowhead page (<code>.../item=<strong>872</strong>/...</code>), or paste the whole address.</p>
    {selected.kind === 'current' && <p className="tables-live">{phase} is the live phase: everyone sees what you change here right away.{next ? ` To prepare something for later, pick ${next.name} above.` : ''}</p>}
    {newZone && <div className="tables-add">
      <label>Zone name<input value={newZone.name} maxLength={TABLE_NAME_MAX} onChange={(event) => setNewZone({ ...newZone, name: event.target.value })} /></label>
      <label>Kind<select value={newZone.kind} onChange={(event) => setNewZone({ ...newZone, kind: event.target.value as 'dungeon' | 'raid' })}><option value="dungeon">Dungeon</option><option value="raid">Raid</option></select></label>
      <label>Players<select value={newZone.players} onChange={(event) => setNewZone({ ...newZone, players: Number(event.target.value) })}>{sizes.map((size) => <option key={size} value={size}>{size}-player</option>)}</select></label>
      <div className="tables-row-actions">
        <button type="button" className="button button-secondary tables-small" onClick={() => setNewZone(null)} disabled={busy}>Cancel</button>
        <button type="button" className="button button-primary tables-small" disabled={busy || !zoneFieldsReady(newZone)} onClick={async () => {
          const made = addZone(newZone, zones.map((candidate) => candidate.zoneId), selected.no)
          if (await run([made.write], `${newZone.name.trim()} added to ${phase} and the phases after it.`)) { setZoneId(made.zoneId); setNewZone(null) }
        }}>Add the zone</button>
      </div>
    </div>}
    {message && <p className={message.error ? 'tables-message tables-bad' : 'tables-message'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
    {!zone && <p className="drops-empty">There are no drop lists yet. Add a zone to start.</p>}
    {zone && <>
      <div className="drops-intro">
        <p><strong>{zone.name}</strong>: {zone.players}-player {zone.kind}{zone.custom ? ', added by the guild.' : '. Built-in list with the guild\u2019s changes on top.'} {zone.inPhase ? `In ${phase}\u2019s lists.` : `Not in ${phase}\u2019s lists.`}
          {zone.custom && zone.inPhase && <> <button type="button" className="button button-secondary tables-small" disabled={busy} onClick={() => setEditingZone(editingZone ? null : { name: zone.name, kind: zone.kind, players: zone.players })}>Rename or resize</button></>}
          {zoneToggle && <>{' '}<button type="button" className="button button-secondary tables-small" disabled={busy} title={zone.inPhase ? `Takes the zone out of ${phase} and the phases after it. Earlier phases keep it.` : `Puts the zone back in the lists from ${phase} on.`}
            onClick={() => void run([zoneToggle], zone.inPhase ? `${zone.name} is out of ${phase} from here on. Its priorities stay.` : `${zone.name} is back in ${phase}.`)}>{zone.inPhase ? `Take the zone out of ${phase}` : `Put the zone back in ${phase}`}</button></>}
          {zoneFollow && <>{' '}<button type="button" className="button button-secondary tables-small" disabled={busy} title={`Takes away what ${phase} says about the zone itself, so it follows ${before || 'the earlier phase'} again.`} onClick={() => void run([zoneFollow], `${zone.name} follows ${before || 'the earlier phase'} again.`)}>{before ? `Follow ${before}` : 'Follow the earlier phase'}</button></>}
        </p>
      </div>
      {editingZone && <div className="tables-add">
        <label>Zone name<input value={editingZone.name} maxLength={TABLE_NAME_MAX} onChange={(event) => setEditingZone({ ...editingZone, name: event.target.value })} /></label>
        <label>Kind<select value={editingZone.kind} onChange={(event) => setEditingZone({ ...editingZone, kind: event.target.value as 'dungeon' | 'raid' })}><option value="dungeon">Dungeon</option><option value="raid">Raid</option></select></label>
        <label>Players<select value={editingZone.players} onChange={(event) => setEditingZone({ ...editingZone, players: Number(event.target.value) })}>{sizes.map((size) => <option key={size} value={size}>{size}-player</option>)}</select></label>
        <div className="tables-row-actions">
          <button type="button" className="button button-secondary tables-small" onClick={() => setEditingZone(null)} disabled={busy}>Cancel</button>
          <button type="button" className="button button-primary tables-small" disabled={busy || !zoneFieldsReady(editingZone) || !editZone(zone, editingZone)} onClick={async () => { const write = editZone(zone, editingZone); if (write && await run([write], `${zone.name} changed from ${phase} on.`)) setEditingZone(null) }}>Save</button>
        </div>
      </div>}
      {zone.inPhase && <>
        {zone.sources.map((source) => <Creature key={source.key} zone={zone} source={source} index={liveSources.findIndex((candidate) => candidate.key === source.key)} count={liveSources.length} phase={phase} previous={before} busy={busy} run={run} />)}
        <Creature zone={zone} source={zone.zoneWide} index={0} count={1} phase={phase} previous={before} busy={busy} run={run} />
        <div className="tables-add tables-new-creature">
          <h4>Add a creature to {zone.name} from {phase} on</h4>
          <label>Name<input value={newCreature.name} maxLength={TABLE_NAME_MAX} onChange={(event) => setNewCreature({ ...newCreature, name: event.target.value })} /></label>
          <label>Kind<select value={newCreature.kind} onChange={(event) => setNewCreature({ ...newCreature, kind: event.target.value as LootSourceKind })}>{lootSourceKinds.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          <label>Creature number (optional)<input value={newCreature.npc} inputMode="numeric" onChange={(event) => setNewCreature({ ...newCreature, npc: event.target.value })} aria-invalid={!npcValid} /></label>
          <div className="tables-row-actions">
            <button type="button" className="button button-primary tables-small" disabled={busy || !creatureReady} onClick={async () => {
              if (await run([addCreature(zone, { name: newCreature.name, kind: newCreature.kind, ...(npc ? { npcId: Number(npc) } : {}) })], `${newCreature.name.trim()} added to ${zone.name}.`)) setNewCreature({ name: '', kind: 'boss', npc: '' })
            }}>Add the creature</button>
          </div>
        </div>
      </>}
    </>}
  </div>
}
