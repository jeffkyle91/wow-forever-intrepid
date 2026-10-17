import type { FormEvent } from 'react'
import { Check } from 'lucide-react'
import { createPriorities, editPriority, newPriorityId, type PriorityRecord as LootPriority } from '../../guildApi'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'

// `phaseNo` is the phase a new priority is added to; an edit never changes the phase a priority is in. Every save is logged in the audit log.
export function PriorityModal({ existing, phaseNo, close, live }: { existing?: LootPriority; phaseNo: number; close: () => void; live: TabContext }) {
  const { setBusy, setMutationError } = live.feedback

  async function savePriority(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const fields = {
      item: String(data.get('item')).trim(),
      encounter: String(data.get('encounter')).trim(),
      rankedPlayers: String(data.get('rankedPlayers')).split(',').map((name) => name.trim()).filter(Boolean),
      councilNote: String(data.get('councilNote')).trim(),
    }
    const who = { uid: live.identity.uid, displayName: live.identity.displayName }
    setBusy(true)
    try {
      // An edit builds on the priority as it is now, so a change someone else made while this was open is not written over unseen.
      if (existing) await editPriority(live.data.allPriorities.find((priority) => priority.id === existing.id) ?? existing, fields, who)
      else await createPriorities([{ id: newPriorityId(), fields: { ...fields, phaseNo } }], who)
      setMutationError('')
      close()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not save loot priority.')
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={existing ? 'Edit loot priority' : 'Add loot priority'} onClose={close}><form className="modal-form" onSubmit={savePriority}>
    <label>Item name<input name="item" defaultValue={existing?.item} placeholder="e.g. Signet of the Deep Earth" required autoFocus /></label>
    <label>Raid · encounter<input name="encounter" defaultValue={existing?.encounter} placeholder="Raid name · Boss name" required /></label>
    <label>Ranked candidates <span className="field-hint">Comma-separated, highest priority first</span><input name="rankedPlayers" defaultValue={existing?.rankedPlayers.join(', ')} placeholder="Morrow, Aurelia, Vex" /></label>
    <label>Council note<textarea name="councilNote" defaultValue={existing?.councilNote} rows={3} placeholder="Why this order? What should council consider?" /></label>
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" disabled={live.feedback.busy}><Check size={15} /> Save priority</button></div>
  </form></Modal>
}
