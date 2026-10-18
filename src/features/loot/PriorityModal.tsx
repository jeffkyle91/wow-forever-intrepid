import { useMemo, useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
import { editPriority, type PriorityRecord as LootPriority } from '../../guildApi'
import { cleanLines, convertLegacy, lineChanges, makeWho, readLines } from '../../shared/game/candidates'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'
import { CandidateEditor } from './CandidateEditor'

// Edits a priority (new ones are added from Browse drops). An edit never changes the phase a priority is in. Every save is in the Log.
// The candidates are built from the roster (see CandidateEditor). A priority written with names only is read against the roster when it opens: a name that
// is one roster character's becomes that character, and anything else (a typo, a soft line) stays as a note, shown before anything is saved.
export function PriorityModal({ existing, close, live }: { existing: LootPriority; close: () => void; live: TabContext }) {
  const { setBusy, setMutationError } = live.feedback
  const who = useMemo(() => makeWho(live.data.roster), [live.data.roster])
  const original = useMemo(() => readLines(existing), [existing])
  const [lines, setLines] = useState(() => convertLegacy(original, who))
  const converted = original.filter((line, index) => line.kind === 'character' && line.id === undefined && lines[index]?.kind === 'note').length

  async function savePriority(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const fields = {
      item: String(data.get('item')).trim(),
      encounter: String(data.get('encounter')).trim(),
      ...lineChanges(live.data.allPriorities.find((priority) => priority.id === existing.id) ?? existing, cleanLines(lines)),
      councilNote: String(data.get('councilNote')).trim(),
    }
    const who = { uid: live.identity.uid, displayName: live.identity.displayName }
    setBusy(true)
    try {
      // An edit builds on the priority as it is now, so a change someone else made while this was open is not written over unseen.
      await editPriority(live.data.allPriorities.find((priority) => priority.id === existing.id) ?? existing, fields, who)
      setMutationError('')
      close()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not save loot priority.')
    } finally {
      setBusy(false)
    }
  }

  return <Modal title="Edit loot priority" onClose={close}><form className="modal-form" onSubmit={savePriority}>
    <label>Item name<input name="item" defaultValue={existing.item} placeholder="e.g. Signet of the Deep Earth" required autoFocus /></label>
    <label>Raid · encounter<input name="encounter" defaultValue={existing.encounter} placeholder="Raid name · Boss name" required /></label>
    <div className="field-group"><span className="field-label">Candidates <span className="field-hint">Highest priority first. Pick characters from the roster, and use a note for what is not a person.</span></span>
      <CandidateEditor lines={lines} onChange={setLines} roster={live.data.roster} who={who} />
      {converted > 0 && <p className="field-hint">{converted === 1 ? '1 name' : `${converted} names`} not found on the roster {converted === 1 ? 'is' : 'are'} kept as {converted === 1 ? 'a note' : 'notes'}.</p>}
    </div>
    <label>Council note<textarea name="councilNote" defaultValue={existing.councilNote} rows={3} placeholder="Why this order? What should council consider?" /></label>
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" disabled={live.feedback.busy}><Check size={15} /> Save priority</button></div>
  </form></Modal>
}
