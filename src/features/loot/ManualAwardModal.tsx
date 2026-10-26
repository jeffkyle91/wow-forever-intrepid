import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, Plus } from 'lucide-react'
import { recordManualAward } from '../../guildApi'
import { makeWho } from '../../shared/game/candidates'
import { currentPhaseNo, phaseName, phaseNoOf } from '../../shared/game/phases'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'
import { listingProgress, nameKey, priorityLookup } from './completion'
import { mainsFirstText, waitingMains, withAltRunNote } from './mainsFirst'
import './MainsFirst.css'
import { bossChoices, DECISIONS, dungeonChoices, MANUAL_ENCOUNTER_MAX, MANUAL_ITEM_MAX, MANUAL_NOTE_MAX, manualAward, possibleDuplicate, SEPARATOR } from './manualAward'
import { useBossOrder } from './useDropTables'
import './ManualAward.css'

// The value of the dungeon choice that means "a dungeon that is not in the list": its name is typed in a field of its own, so free text always works.
const OTHER_DUNGEON = '__other__'

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
  const [dungeonPick, setDungeonPick] = useState('')
  const [otherDungeon, setOtherDungeon] = useState('')
  const [boss, setBoss] = useState('')
  const [recipientId, setRecipientId] = useState('')
  const [awardedAt, setAwardedAt] = useState(today)
  const [decision, setDecision] = useState('roll')
  const [awardNote, setAwardNote] = useState('')
  const [altRun, setAltRun] = useState(false)
  const itemInput = useRef<HTMLInputElement>(null)

  const listed = [...allPriorities, ...hiddenPriorities].filter((priority) => phaseNoOf(priority) === phaseNo)
  const itemNames = [...new Set(listed.map((priority) => priority.item))].sort((a, b) => a.localeCompare(b))
  const encounters = listed.map((priority) => priority.encounter).filter(Boolean)
  const bossOrder = useBossOrder(live.data.lootTables, phaseNo)
  const dungeon = dungeonPick === OTHER_DUNGEON ? otherDungeon : dungeonPick
  const dungeons = dungeonChoices(live.data.zoneList, encounters, dungeonPick === OTHER_DUNGEON ? '' : dungeonPick)
  const bosses = bossChoices(dungeon, bossOrder(dungeon), encounters)
  const people = [...roster].sort((a, b) => a.name.localeCompare(b.name))
  // An item that is on a priority list of the phase is recorded under the list's own spelling (however it was typed), so it reads the same everywhere.
  const onList = item.trim() === '' ? undefined : listed.find((priority) => nameKey(priority.item) === nameKey(item))
  // Mains get loot priority over alts: when the item is on a list of the phase and an alt is chosen while a main on it is still waiting, say so (a warning, never a block).
  // The tick is for this award only: it resets with the item and the recipient.
  // A list that was taken off (hidden) is left out of every list and count, so its mains are not waiting for anything: no warning for it.
  const waiting = onList && !onList.hidden ? waitingMains(onList, listingProgress(onList, live.data.awards, priorityLookup([...allPriorities, ...hiddenPriorities]), who).received, who, roster, recipientId || undefined) : []
  const result = manualAward({ item: onList?.item ?? item, dungeon, boss, recipientId, awardedAt, decision, awardNote: altRun && waiting.length > 0 ? withAltRunNote(awardNote) : awardNote }, who, phaseNo)
  const hasList = onList !== undefined
  // The Log filters a drop by its dungeon: say so while there is none (a whole "dungeon · boss" typed as the boss counts as one).
  const placeHint = dungeon.trim() !== '' || boss.includes(SEPARATOR) ? '' : boss.trim() !== '' ? 'Without a dungeon, the Log lists this drop under \u201cOther priorities\u201d in its dungeon filter.' : 'Pick the dungeon so the Log can filter this drop by it.'
  // Two leaders can record the same drop, and an addon import can arrive for one typed here: warn, never block (a second copy can really drop).
  const duplicate = result.award ? possibleDuplicate(result.award, live.data.awards) : undefined
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
        // The next drop of the same night: the date, the dungeon, the boss and how it was decided stay.
        setItem('')
        setRecipientId('')
        setAwardNote('')
        setAltRun(false)
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
      <label>Item<input ref={itemInput} value={item} list="manual-award-items" maxLength={MANUAL_ITEM_MAX} autoComplete="off" autoFocus required placeholder="The item's name" onChange={(event) => { setItem(event.target.value); setAltRun(false) }} /></label>
      <datalist id="manual-award-items">{itemNames.map((name) => <option key={name} value={name} />)}</datalist>
      {hasList && <p className="manual-award-hint">This item has a priority list in {phaseName(settings, phaseNo)}: a receipt to someone on it marks them received there.</p>}
      <label>Awarded to<select value={recipientId} onChange={(event) => { setRecipientId(event.target.value); setAltRun(false) }} required>
        <option value="" disabled>Choose a character</option>
        {people.map((player) => <option key={player.id} value={player.id}>{player.name} ({player.className})</option>)}
      </select></label>
      {waiting.length > 0 && <div className={altRun ? 'mains-first mains-first-off' : 'mains-first'} role="status">
        <p>{altRun ? 'Alt-only run: the warning is off for this award, and its note starts with "Alt-only run."' : mainsFirstText(waiting)}</p>
        <label className="mains-first-tick"><input type="checkbox" checked={altRun} onChange={(event) => setAltRun(event.target.checked)} /> Alt-only run</label>
      </div>}
      <div className="manual-award-row manual-award-place">
        <div className="manual-award-dungeon">
          <label>Dungeon<select value={dungeonPick} aria-describedby={placeHint ? 'manual-award-place-hint' : undefined} onChange={(event) => setDungeonPick(event.target.value)}>
            <option value="">Not noted</option>
            {dungeons.raids.length > 0 && <optgroup label="Raids">{dungeons.raids.map((name) => <option key={name} value={name}>{name}</option>)}</optgroup>}
            {dungeons.dungeons.length > 0 && <optgroup label="Dungeons">{dungeons.dungeons.map((name) => <option key={name} value={name}>{name}</option>)}</optgroup>}
            {dungeons.others.length > 0 && <optgroup label="From this phase's priorities">{dungeons.others.map((name) => <option key={name} value={name}>{name}</option>)}</optgroup>}
            <option value={OTHER_DUNGEON}>Other…</option>
          </select></label>
          {dungeonPick === OTHER_DUNGEON && <label>Dungeon name<input value={otherDungeon} maxLength={MANUAL_ENCOUNTER_MAX} autoComplete="off" placeholder="The dungeon's name" onChange={(event) => setOtherDungeon(event.target.value)} /></label>}
        </div>
        <label>Boss (optional)<input value={boss} list="manual-award-bosses" maxLength={MANUAL_ENCOUNTER_MAX} autoComplete="off" placeholder="The boss it dropped from" onChange={(event) => setBoss(event.target.value)} /></label>
      </div>
      <datalist id="manual-award-bosses">{bosses.map((name) => <option key={name} value={name} />)}</datalist>
      {placeHint && <p className="manual-award-hint" id="manual-award-place-hint">{placeHint}</p>}
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
      {duplicate && <p className="manual-award-duplicate" role="status"><strong>Already recorded?</strong> {duplicate.item} was recorded to {duplicate.recipient} on {duplicate.awardedAt}. If that is the same drop, cancel. If a second copy dropped, record it too.</p>}
      <div className="modal-actions">
        <button type="button" className="button button-secondary" onClick={close} disabled={busy}>Cancel</button>
        <button type="button" className="button button-secondary" disabled={!ready} onClick={() => void record(true)}><Plus size={15} /> Record and add another</button>
        <button className="button button-primary" disabled={!ready}><Check size={15} /> {duplicate ? 'Record it again' : 'Record loot'}</button>
      </div>
    </form>
  </Modal>
}
