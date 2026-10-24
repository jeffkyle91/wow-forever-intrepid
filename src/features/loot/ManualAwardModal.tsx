import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, Plus } from 'lucide-react'
import { recordManualAward } from '../../guildApi'
import { makeWho } from '../../shared/game/candidates'
import { currentPhaseNo, phaseName, phaseNoOf } from '../../shared/game/phases'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'
import { nameKey } from './completion'
import { DECISIONS, MANUAL_ENCOUNTER_MAX, MANUAL_ITEM_MAX, MANUAL_NOTE_MAX, manualAward } from './manualAward'
import './ManualAward.css'

const today = () => {
  const now = new Date()
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
}

// Record loot: a drop decided without a priority list (a need-before-greed roll, a decision on the night). It is the manual award of
// docs/design/audit-first-loot.md: no priority and no candidate order are saved, so nothing pretends a list existed. The recipient is a roster character,
// the raid date is kept apart from the time it is entered, and the award goes in the current phase with its entry in the Log, in one batch. An item whose name matches a
// priority of the phase still marks that listing received (see awardsForPriority), so the list stays right whichever way a drop was recorded.
export function ManualAwardModal({ close, live }: { close: () => void; live: TabContext }) {
  const { busy, setBusy, setMutationError, setNotice } = live.feedback
  const { roster, settings, allPriorities, hiddenPriorities } = live.data
  const who = useMemo(() => makeWho(roster), [roster])
  const phaseNo = currentPhaseNo(settings)
  const [item, setItem] = useState('')
  const [encounter, setEncounter] = useState('')
  const [recipientId, setRecipientId] = useState('')
  const [awardedAt, setAwardedAt] = useState(today)
  const [decision, setDecision] = useState('roll')
  const [awardNote, setAwardNote] = useState('')
  const itemInput = useRef<HTMLInputElement>(null)

  const listed = [...allPriorities, ...hiddenPriorities].filter((priority) => phaseNoOf(priority) === phaseNo)
  const itemNames = [...new Set(listed.map((priority) => priority.item))].sort((a, b) => a.localeCompare(b))
  const encounters = [...new Set(listed.map((priority) => priority.encounter).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const people = [...roster].sort((a, b) => a.name.localeCompare(b.name))
  // An item that is on a priority list of the phase is recorded under the list's own spelling (however it was typed), so it reads the same everywhere.
  const onList = item.trim() === '' ? undefined : listed.find((priority) => nameKey(priority.item) === nameKey(item))
  const result = manualAward({ item: onList?.item ?? item, encounter, recipientId, awardedAt, decision, awardNote }, who, phaseNo)
  const hasList = onList !== undefined
  const ready = !busy && result.award !== undefined

  async function record(another: boolean) {
    const { award } = result
    if (!award || busy) return
    setBusy(true)
    try {
      await recordManualAward(award, { uid: live.identity.uid, displayName: live.identity.displayName })
      setMutationError('')
      setNotice(`Recorded ${award.item} to ${award.recipient}.`)
      if (another) {
        // The next drop of the same night: the date, the boss and how it was decided stay.
        setItem('')
        setRecipientId('')
        setAwardNote('')
        itemInput.current?.focus()
      } else close()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not record the loot.')
    } finally {
      setBusy(false)
    }
  }

  return <Modal title="Record loot" onClose={close}>
    <form className="modal-form manual-award-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void record(false) }}>
      <p className="manual-award-intro">For a drop decided without a priority list, such as a roll. It is recorded in <strong>{phaseName(settings, phaseNo)}</strong> and written to the Log.</p>
      <label>Item<input ref={itemInput} value={item} list="manual-award-items" maxLength={MANUAL_ITEM_MAX} autoComplete="off" autoFocus required placeholder="The item's name" onChange={(event) => setItem(event.target.value)} /></label>
      <datalist id="manual-award-items">{itemNames.map((name) => <option key={name} value={name} />)}</datalist>
      {hasList && <p className="manual-award-hint">This item has a priority list in {phaseName(settings, phaseNo)}: a receipt to someone on it marks them received there.</p>}
      <label>Awarded to<select value={recipientId} onChange={(event) => setRecipientId(event.target.value)} required>
        <option value="" disabled>Choose a character</option>
        {people.map((player) => <option key={player.id} value={player.id}>{player.name} ({player.className})</option>)}
      </select></label>
      <label>Boss or dungeon (optional)<input value={encounter} list="manual-award-bosses" maxLength={MANUAL_ENCOUNTER_MAX} autoComplete="off" placeholder="For example: The Deadmines · Edwin VanCleef" onChange={(event) => setEncounter(event.target.value)} /></label>
      <datalist id="manual-award-bosses">{encounters.map((name) => <option key={name} value={name} />)}</datalist>
      <div className="manual-award-row">
        <label>Raid date<input type="date" value={awardedAt} required onChange={(event) => setAwardedAt(event.target.value)} /></label>
        <div className="manual-award-decision-field"><span id="manual-award-decision-label">How it was decided</span>
          <div className="segmented-control manual-award-decision" role="group" aria-labelledby="manual-award-decision-label">
            {DECISIONS.map((option) => <button key={option.value} type="button" className={decision === option.value ? 'segment selected' : 'segment'} aria-pressed={decision === option.value} onClick={() => setDecision(option.value)}>{option.label}</button>)}
          </div>
        </div>
      </div>
      <label>Note (optional)<textarea value={awardNote} maxLength={MANUAL_NOTE_MAX} rows={2} placeholder="For example: both rolled, highest roll won" onChange={(event) => setAwardNote(event.target.value)} /></label>
      {result.problem && !result.missing && <p className="manual-award-problem" role="alert">{result.problem}</p>}
      <div className="modal-actions">
        <button type="button" className="button button-secondary" onClick={close} disabled={busy}>Cancel</button>
        <button type="button" className="button button-secondary" disabled={!ready} onClick={() => void record(true)}><Plus size={15} /> Record and add another</button>
        <button className="button button-primary" disabled={!ready}><Check size={15} /> Record loot</button>
      </div>
    </form>
  </Modal>
}
