import type { FormEvent } from 'react'
import { Check } from 'lucide-react'
import { saveGuildRecord, type PriorityRecord as LootPriority } from '../../guildApi'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'

export function PriorityModal({ existing, close, live }: { existing?: LootPriority; close: () => void; live: TabContext }) {
  const { setBusy, setMutationError } = live.feedback

  async function savePriority(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const priority: LootPriority = {
      id: existing ? existing.id : crypto.randomUUID(),
      item: String(data.get('item')).trim(),
      encounter: String(data.get('encounter')).trim(),
      rankedPlayers: String(data.get('rankedPlayers')).split(',').map((name) => name.trim()).filter(Boolean),
      councilNote: String(data.get('councilNote')).trim(),
    }
    setBusy(true)
    try {
      const { id, ...record } = priority
      await saveGuildRecord('lootPriorities', id, record)
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
