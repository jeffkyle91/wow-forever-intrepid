import { useMemo, useState, type FormEvent } from 'react'
import { Check, Shield } from 'lucide-react'
import { recordAward, recordAwardThroughNote, type NewAward, type PriorityRecord as LootPriority } from '../../guildApi'
import { coinsArt } from '../../shared/art'
import { lineChanges, makeWho, readLines, receiveThroughNote, sortPlayers } from '../../shared/game/candidates'
import type { TabContext } from '../../shared/tabs/types'
import { ArtIcon } from '../../shared/ui/ArtIcon'
import { Modal } from '../../shared/ui/Modal'
import { phaseNoOf } from '../../shared/game/phases'
import { listingProgress, priorityLookup, recipientChoices } from './completion'
import { AWARD_NOTE_MAX, mainsFirstText, waitingMains, withAltRunNote } from './mainsFirst'
import './MainsFirst.css'

// The award snapshot (candidate order and council note at decision time) is built here,
// from the `priority` captured when the modal was opened, never from live data. It keeps the names and the ids of the lines exactly as the priority stored them.
//
// Who can receive: anyone on a character line (by id when the line has one) and, when the priority has an open note ("any warlock who didn't get X"),
// any roster character who is not on the list. The second kind is recorded together with a change to the priority that puts them on a character line
// where the note was and moves the note down (see receiveThroughNote), so the list reads as a record of who received it and the note stays for the next one.
export function AwardModal({ priority, awardedAt, close, live }: { priority: LootPriority; awardedAt: string; close: () => void; live: TabContext }) {
  const { setBusy, setMutationError } = live.feedback
  const who = useMemo(() => makeWho(live.data.roster), [live.data.roster])
  // Offer the first listing that is still open, so a player who already received the item is not the default again.
  const progress = listingProgress(priority, live.data.awards, priorityLookup([...live.data.allPriorities, ...live.data.hiddenPriorities]), who)
  const lines = readLines(priority)
  const choices = recipientChoices(priority, progress, who)
  const nextLine = lines[progress.next]
  const nextKey = nextLine ? who.lineKey(nextLine) : undefined
  const defaultRecipient = nextKey !== undefined && choices.some((choice) => choice.key === nextKey) ? `p:${nextKey}` : ''
  const openNotes = lines.flatMap((line, index) => (line.kind === 'note' && !line.done ? [{ text: line.text, index }] : []))
  const listed = new Set(choices.map((choice) => choice.key))
  const others = sortPlayers(live.data.roster.filter((player) => !listed.has(`id:${player.id}`)), 'class')
  // Mains get loot priority over alts: a warning, never a block. The tick is for this award only, so it resets when the recipient changes.
  const [recipient, setRecipient] = useState(defaultRecipient)
  const [altRun, setAltRun] = useState(false)
  const recipientLine = recipient.startsWith('p:') ? lines.find((entry) => who.lineKey(entry) === recipient.slice(2)) : undefined
  const recipientId = recipient.startsWith('n:') ? recipient.split(':')[2] : recipientLine?.kind === 'character' ? (recipientLine.id !== undefined ? who.player(recipientLine.id) : who.byName(recipientLine.name))?.id : undefined
  const waiting = waitingMains(priority, progress.received, who, live.data.roster, recipientId)

  async function submitAward(event: FormEvent<HTMLFormElement>, priority: LootPriority) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const choice = String(data.get('recipient'))
    // An alt-only run starts its note with "Alt-only run."; the leader's own words are never cut, so a note that no longer fits is refused here, before anything is written.
    const note = altRun && waiting.length > 0 ? withAltRunNote(String(data.get('awardNote'))) : String(data.get('awardNote')).trim()
    if (note.length > AWARD_NOTE_MAX) { setMutationError(`The note can be up to ${AWARD_NOTE_MAX} characters${altRun ? ', and "Alt-only run." takes 14 of them' : ''}.`); return }
    const base = {
      priorityId: priority.id,
      item: priority.item,
      encounter: priority.encounter,
      awardedAt: String(data.get('awardedAt')),
      prioritySnapshot: [...priority.rankedPlayers],
      ...(priority.rankedIds ? { prioritySnapshotIds: [...priority.rankedIds] } : {}),
      councilNoteSnapshot: priority.councilNote,
      awardNote: note,
      phaseNo: phaseNoOf(priority),
    }
    const author = { uid: live.identity.uid, displayName: live.identity.displayName }
    setBusy(true)
    try {
      if (choice.startsWith('n:')) {
        const [, noteIndex, id] = choice.split(':')
        const player = who.player(id ?? '')
        if (!player) throw new Error('Choose a character from the roster.')
        const award: NewAward = { ...base, recipient: player.name, recipientId: player.id }
        await recordAwardThroughNote(award, priority, lineChanges(priority, receiveThroughNote(lines, Number(noteIndex), player)), author)
      } else {
        const line = lines.find((entry) => who.lineKey(entry) === choice.slice(2))
        if (line?.kind !== 'character') throw new Error('Choose who received it.')
        // The recipient's name is the roster's current one when the line has an id (a rename since the list was written is fine). A line with only a
        // name keeps that name, and gets the roster character's id when the roster spells the name the same.
        const player = line.id !== undefined ? who.player(line.id) : who.byName(line.name)
        const exact = player && (line.id !== undefined || player.name === line.name)
        const award: NewAward = { ...base, recipient: exact ? player.name : line.name, ...(exact ? { recipientId: player.id } : {}) }
        await recordAward(award, author)
      }
      setMutationError('')
      close()
      live.navigate('history')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not record loot award.')
    } finally {
      setBusy(false)
    }
  }

  const label = (choice: { name: string; listed: number; received: number }) => choice.listed > 1 ? `${choice.name} (${choice.received} of ${choice.listed} received)` : choice.received ? `${choice.name} (received)` : choice.name

  return <Modal title="Record loot award" onClose={close}><div className="award-modal-item"><span className="item-gem"><ArtIcon src={coinsArt} className="loot-art-icon" /></span><span><strong>{priority.item}</strong><small>{priority.encounter}</small></span></div><form className="modal-form" onSubmit={(event) => submitAward(event, priority)}>
    <label>Awarded to<select name="recipient" value={recipient} onChange={(event) => { setRecipient(event.target.value); setAltRun(false) }} required>
      <option value="" disabled>Choose a character</option>
      {choices.length > 0 && <optgroup label="On the list">{choices.map((choice) => <option key={choice.key} value={`p:${choice.key}`}>{label(choice)}</option>)}</optgroup>}
      {openNotes.map((note) => <optgroup key={note.index} label={`Through the note: ${note.text}`}>{others.map((player) => <option key={player.id} value={`n:${note.index}:${player.id}`}>{player.name} ({player.className})</option>)}</optgroup>)}
    </select></label>
    {openNotes.length > 0 && <p className="field-hint">A character chosen through a note is put on the list where the note is, and the note moves down.</p>}
    {waiting.length > 0 && <div className={altRun ? 'mains-first mains-first-off' : 'mains-first'} role="status">
      <p>{altRun ? 'Alt-only run: the warning is off for this award, and its note starts with "Alt-only run."' : mainsFirstText(waiting)}</p>
      <label className="mains-first-tick"><input type="checkbox" checked={altRun} onChange={(event) => setAltRun(event.target.checked)} /> Alt-only run</label>
    </div>}
    <label>Award date<input type="date" name="awardedAt" defaultValue={awardedAt} required /></label>
    <label>Council decision note<textarea name="awardNote" rows={3} placeholder="Optional context for the permanent record" /></label>
    <p className="snapshot-callout"><Shield size={15} /> The current priority order and council note will be saved with this award.</p>
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" disabled={live.feedback.busy || lines.length === 0}><Check size={15} /> Record award</button></div>
  </form></Modal>
}

