import { useMemo, useState } from 'react'
import { writeLootTables } from '../../guildApi'
import { looksLikeCapture, mergeDrops, readCapturePaste, readDropsPaste, type CandidateZone, type ItemEvidence } from '../../shared/game/dropsString'
import type { TableWrite } from '../../shared/game/guildTables'
import { dropTables as builtIn } from '../../shared/lib/dropTables'
import { isMissingItem, useItemInfo } from '../../shared/lib/itemInfo'
import type { TabContext } from '../../shared/tabs/types'
import { ItemTooltip } from '../../shared/ui/ItemTooltip'
import {
  JOURNAL_ITEMS_SAVED, applyWrites, buildImportSave, buildPreview, importReason, journalReason, noAnswers, takenZoneIds, zoneIdFor, type CreatureRow, type ImportAnswers,
  type ImportCounts, type ImportSetup, type ItemRow, type ZoneRow,
} from './dropImport'
import './DropImport.css'

// "Import a drop list" (LOOT-008, docs/design/drop-list-import.md section 7), at the top of Edit the drop lists. A leader pastes the addon's drops
// strings (/im drops) or a capture file, answers what isn't clear, and saves into the phase picked in the editor, in one confirm. The browser reads the
// text itself and never stores it. dropImport.ts does the matching and builds the writes; this holds the answers and runs the save.

type Paste = { from: 'addon' | 'capture'; zones: CandidateZone[]; ids: string[]; skipped: number } | { errors: string[] } | null

function readPaste(text: string): Paste {
  if (!text.trim()) return null
  if (looksLikeCapture(text)) {
    const read = readCapturePaste(text)
    return read.ok ? { from: 'capture', zones: read.zones, ids: [], skipped: 0 } : { errors: read.errors }
  }
  const read = readDropsPaste(text)
  if (!read.ok) return { errors: [read.message] }
  return { from: 'addon', zones: mergeDrops(read.strings.map((one) => one.model)), ids: read.strings.map((one) => one.model.id), skipped: read.strings.reduce((count, one) => count + one.rowErrors.length, 0) }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDate = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1] ?? ''} ${Number(date.slice(8, 10))}`
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

function evidenceText(evidence: ItemEvidence, trash: boolean): string[] {
  const parts: string[] = []
  const seen = evidence.seen
  if (seen) parts.push(`${seen.via === 'roll' ? 'rolled for' : 'seen'} ${seen.n === 1 ? 'once' : `${seen.n} times`}, last ${shortDate(seen.last)}`)
  if (evidence.ej) parts.push("the game's journal lists it")
  if (evidence.journal) parts.push(seen || evidence.capture ? 'DungeonJournal lists it' : 'DungeonJournal lists it, not seen in the game')
  if (evidence.capture) parts.push('in the capture file')
  if (seen?.quest) parts.push('starts a quest')
  if (trash && seen?.boe) parts.push('may be a world drop')
  return parts
}

function statusText(row: ItemRow, phase: string): string | undefined {
  switch (row.status) {
    case 'already': return 'already listed'
    case 'elsewhere': return `on ${row.where}`
    case 'takenOff': return 'taken off by a leader'
    case 'claimed': return `under ${row.where} in this import`
    case 'zoneWide': return 'offered for the zone-wide list'
    case 'noRoom': return `no room left in ${phase}: the next phase can add it`
    default: return undefined
  }
}

function countsText(counts: ImportCounts): string {
  const parts = [
    counts.newZones ? `${plural(counts.zones, 'zone', 'zones')} (${counts.newZones} new)` : plural(counts.zones, 'zone', 'zones'),
    counts.newCreatures ? `${plural(counts.creatures, 'creature', 'creatures')} (${counts.newCreatures} new)` : plural(counts.creatures, 'creature', 'creatures'),
    plural(counts.items, 'item', 'items'),
    ...(counts.journalItems ? [`${counts.journalItems} from DungeonJournal`] : []),
  ]
  return parts.join(', ')
}

type Answering = { ticks: (id: string, value: boolean) => void; answers: ImportAnswers; update: (next: ImportAnswers) => void; busy: boolean; phase: string }

function ItemLine({ row, trash, set }: { row: ItemRow; trash: boolean; set: Answering }) {
  const state = useItemInfo(row.itemId)
  const gameName = row.evidence.seen?.name
  const status = statusText(row, set.phase)
  const notes = [...evidenceText(row.evidence, trash), ...(status ? [status] : [])]
  return <li className={`import-item${row.tickable ? '' : ' import-item-off'}`}>
    {row.tickable
      ? <input type="checkbox" checked={row.ticked} disabled={set.busy} aria-label={`Add item ${gameName ?? row.itemId}`} onChange={(event) => set.ticks(row.id, event.target.checked)} />
      : <span className="import-tick-space" aria-hidden="true" />}
    <ItemTooltip itemId={row.itemId} {...(gameName ? { fallbackName: gameName } : {})} />
    {isMissingItem(state) && <small className="import-note">not on Wowhead yet</small>}
    {state?.status === 'error' && !isMissingItem(state) && <small className="import-note tables-bad">{state.message}</small>}
    {notes.length > 0 && <small className="import-note">{notes.join('; ')}</small>}
  </li>
}

function CreatureBlock({ zone, row, set }: { zone: ZoneRow; row: CreatureRow; set: Answering }) {
  const journal = row.items.filter((item) => item.journalOnly && item.tickable)
  const chips = [
    row.kind === 'zonewide' ? 'zone-wide' : row.kind,
    ...(row.npcId !== undefined ? [`NPC ${row.npcId}`] : []),
    ...(row.status === 'new' ? ['new'] : []),
    ...(row.guessed ? ['guessed from the encounter'] : []),
    ...(row.status === 'takenOut' ? [`taken out of ${set.phase}`] : []),
  ]
  const creatureAnswer = row.answerKey ?? row.id
  const current = set.answers.creatures[creatureAnswer]
  return <section className={`import-creature${row.saved ? '' : ' import-creature-off'}`}>
    <header>
      {row.creatureTickable
        ? <label className="import-creature-name"><input type="checkbox" checked={row.saved} disabled={set.busy} aria-label={row.status === 'takenOut' ? `Bring back ${row.name}` : `Add ${row.name}`} onChange={(event) => set.ticks(row.id, event.target.checked)} /><strong>{row.name}</strong></label>
        : <strong className="import-creature-name">{row.name}</strong>}
      {chips.map((chip) => <span key={chip} className="drops-kind">{chip}</span>)}
    </header>
    {row.near.length > 0 && zone.status !== 'unmatched' && <label className="import-answer">Same as
      <select value={current && 'same' in current ? current.same : current ? 'new' : ''} disabled={set.busy} onChange={(event) => {
        const value = event.target.value
        set.update({ ...set.answers, creatures: { ...set.answers.creatures, [creatureAnswer]: value === '' ? undefined : value === 'new' ? { make: true } : { same: value } } })
      }}>
        <option value="">Choose</option>
        {row.near.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}
        <option value="new">A new creature</option>
      </select>
    </label>}
    {row.differs && <label className="import-answer import-check"><input type="checkbox" checked={row.rename} disabled={set.busy} onChange={(event) => set.update({ ...set.answers, renames: { ...set.answers.renames, [row.id]: event.target.checked } })} />
      Rename to {row.differs.name ?? row.name}{row.differs.kind ? ` (${row.differs.kind})` : ''}</label>}
    <ul className="import-items">{row.items.map((item) => <ItemLine key={item.id} row={item} trash={row.kind === 'trash'} set={set} />)}</ul>
    {journal.length > 0 && <button type="button" className="button button-secondary tables-small" disabled={set.busy} onClick={() => {
      const ticks = { ...set.answers.ticks }
      for (const item of journal) ticks[item.id] = true
      set.update({ ...set.answers, ticks: { ...ticks, [row.id]: true } })
    }}>Tick DungeonJournal&rsquo;s {plural(journal.length, 'item', 'items')}</button>}
  </section>
}

function ZoneBlock({ zone, setup, set, canMake }: { zone: ZoneRow; setup: ImportSetup; set: Answering; canMake: boolean }) {
  const ownAnswer = zone.answerKeys[0] ?? zone.id
  const answer = set.answers.zones[ownAnswer]
  const choose = (value: string) => {
    const next = value === '' ? undefined : value === 'new' ? { make: true as const, zoneId: zoneIdFor(zone, takenZoneIds(setup)) } : { pick: Number(value) }
    set.update({ ...set.answers, zones: { ...set.answers.zones, [ownAnswer]: next } })
  }
  // Open when there is something to save or decide; a zone whose rows are all already listed starts closed.
  const anything = zone.creatures.some((creature) => creature.saved || creature.creatureTickable || creature.status === 'unmatched' || creature.differs || creature.items.some((item) => item.tickable))
  const unmatchedWhy = zone.unmatchedWhy === 'tie' ? 'More than one zone has this name.' : zone.unmatchedWhy === 'catalog' ? "It's in the older raid list, which can't hold drop lists." : undefined
  return <details className={`import-zone import-${zone.status}`} open={zone.status !== 'matched' || anything}>
    <summary>
      <strong>{zone.status === 'new' ? zone.name : zone.appName ?? zone.name}</strong>
      <span>{zone.players}-player {zone.kind}</span>
      {zone.appName && <span className="import-note">as {zone.name} in the paste</span>}
      {zone.status === 'new' && <span className="drops-kind tables-added">new zone</span>}
      {zone.status === 'matched' && zone.tickIn && <span className="drops-kind">not in {set.phase} yet</span>}
    </summary>
    <div className="import-zone-body">
      {(zone.status === 'unmatched' || zone.how === 'pick' || zone.status === 'new') && <label className="import-answer">Zone
        <select value={answer ? ('pick' in answer ? String(answer.pick) : 'new') : ''} disabled={set.busy} onChange={(event) => choose(event.target.value)}>
          <option value="">Choose</option>
          {zone.options.map((option) => <option key={option.zoneId} value={option.zoneId}>{option.name} ({option.players}-player {option.kind})</option>)}
          {canMake && <option value="new">Make a new zone</option>}
        </select>
      </label>}
      {unmatchedWhy && <p className="import-note">{unmatchedWhy}</p>}
      {zone.status === 'new' && <p className="import-note">{zone.kind === 'raid' && [10, 20, 40].includes(zone.players) ? 'A zone is permanent, and a raid of this size can be scheduled.' : 'A zone is permanent.'}</p>}
      {zone.takenOut && <label className="import-answer import-check"><input type="checkbox" checked={zone.zoneTicked} disabled={set.busy} onChange={(event) => set.ticks(zone.id, event.target.checked)} />Put it back in {set.phase}</label>}
      {zone.journalPartial && <p className="import-note">DungeonJournal calls its list for this dungeon incomplete.</p>}
      {zone.creatures.map((creature) => <CreatureBlock key={creature.id} zone={zone} row={creature} set={set} />)}
    </div>
  </details>
}

export function DropImportPanel({ live, phaseNo, phase }: { live: TabContext; phaseNo: number; phase: string }) {
  const [text, setText] = useState('')
  const [answers, setAnswers] = useState<ImportAnswers>(noAnswers)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const { busy, setBusy, setMutationError } = live.feedback
  const docs = live.data.lootTables
  const paste = useMemo(() => readPaste(text), [text])
  const setup: ImportSetup = useMemo(() => ({
    captures: builtIn, docs, catalog: live.data.raidZoneCatalog, currentPhase: live.data.settings.phaseHistory?.length ?? 0, phaseNo,
    journalSaving: JOURNAL_ITEMS_SAVED, canMakeZones: live.identity.canEditRoster,
  }), [docs, live.data.raidZoneCatalog, live.data.settings.phaseHistory, phaseNo, live.identity.canEditRoster])
  const preview = useMemo(() => (paste && 'zones' in paste ? buildPreview(paste.zones, setup, answers) : null), [paste, setup, answers])
  const previewing = live.identity.isPreviewing
  const counts = preview?.counts
  const nothing = !counts || (counts.items + counts.journalItems === 0 && counts.creatures === 0 && counts.zones === 0)

  const update = (next: ImportAnswers) => { setAnswers(next); setConfirming(false) }
  const set: Answering = { answers, update, busy, phase, ticks: (id, value) => update({ ...answers, ticks: { ...answers.ticks, [id]: value } }) }

  async function save() {
    if (!preview || !paste || !('zones' in paste)) return
    const plan = buildImportSave(preview, setup)
    const who = { uid: live.identity.uid, displayName: live.identity.displayName }
    const reason = importReason(paste.from, paste.ids)
    let written = 0
    setBusy(true)
    setConfirming(false)
    try {
      const count = (ids: string[]) => { written += ids.length }
      const write = (writes: TableWrite[], why: string) => (writes.length ? writeLootTables(writes, who, count, why) : Promise.resolve())
      await write(plan.first, reason)
      const second = plan.second(applyWrites(docs, plan.first))
      await write(second.ticks, reason)
      for (const call of second.journal) await write(call.writes, journalReason(call.version)) // each version of DungeonJournal with its own reason
      setMutationError('')
      setMessage({ text: `Saved to ${phase}: ${countsText(preview.counts)}.`, error: false })
      setText('')
      setAnswers(noAnswers())
    } catch (error) {
      const stale = (error as { code?: string } | null)?.code === 'permission-denied'
      const why = stale ? 'The change was refused: someone may have changed the same list a moment ago, or the phase may have just started.' : error instanceof Error ? error.message : 'The save stopped.'
      setMessage({ text: `${plural(written, 'change was', 'changes were')} saved before it stopped. ${why} Paste the same text again to finish.`, error: true })
    } finally {
      setBusy(false)
    }
  }

  return <details className="tables-import">
    <summary><span className="tables-zones-title">Import a drop list</span></summary>
    <div className="tables-import-inner">
      <div className="tables-add">
        <label>Drops strings from the addon, or a capture file
          <textarea value={text} rows={3} disabled={busy} placeholder="IM1:drops:j:..." onChange={(event) => { setText(event.target.value); setAnswers(noAnswers()); setConfirming(false); setMessage(null) }} />
        </label>
        <label className="import-file">Or a capture file<input type="file" accept=".json,application/json,.txt,text/plain" disabled={busy} onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void file.text().then((read) => { setText(read); setAnswers(noAnswers()); setMessage(null) })
          event.target.value = ''
        }} /></label>
      </div>
      {paste && 'errors' in paste && <ul className="tables-message tables-bad import-errors" role="alert">{paste.errors.map((error) => <li key={error}>{error}</li>)}</ul>}
      {paste && 'zones' in paste && paste.skipped > 0 && <p className="import-note">{plural(paste.skipped, 'row of the string could', 'rows of the string could')} not be read and {paste.skipped === 1 ? 'is' : 'are'} left out.</p>}
      {preview && <>
        {preview.zones.map((zone) => <ZoneBlock key={zone.id} zone={zone} setup={setup} set={set} canMake={setup.canMakeZones} />)}
        <div className="tables-setup-foot">
          <span className="tables-note">{counts ? countsText(counts) : ''}{counts?.unanswered ? `. ${plural(counts.unanswered, 'question', 'questions')} unanswered: left out.` : ''}</span>
          <span className="tables-actions">
            {!confirming && <button type="button" className="button button-primary tables-small" disabled={busy || previewing || nothing} onClick={() => setConfirming(true)}>Save to {phase}</button>}
            {confirming && <>
              <button type="button" className="button button-secondary tables-small" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="button button-primary tables-small" disabled={busy || previewing} onClick={() => void save()}>Save {counts ? countsText(counts) : ''}</button>
            </>}
          </span>
        </div>
        {previewing && <p className="import-note">Saving is off in VIEW AS.</p>}
      </>}
      {message && <p className={message.error ? 'tables-message tables-bad' : 'tables-message'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
    </div>
  </details>
}
