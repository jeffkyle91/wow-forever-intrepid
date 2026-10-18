import { Trash2 } from 'lucide-react'
import { deletePriorities, type PriorityRecord as LootPriority } from '../../guildApi'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'

// Takes a priority that was carried over off the list of the phase it was carried into: for one carried over by mistake, or no longer needed. The priority is
// deleted (and logged); the earlier phase's own priority is not touched, so the item can be carried over again from Carry over. Awards recorded from the
// carried priority stay in the Log and in the awards, with the candidate order they were decided from.
export function RemoveCarriedModal({ priority, from, phase, awards, close, live }: { priority: LootPriority; from: string; phase: string; awards: number; close: () => void; live: TabContext }) {
  const { setBusy, setMutationError, setNotice } = live.feedback

  async function remove() {
    setBusy(true)
    try {
      await deletePriorities([priority], { uid: live.identity.uid, displayName: live.identity.displayName })
      setMutationError('')
      setNotice(`${priority.item} was taken off ${phase}'s list.`)
      close()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not remove the priority.')
    } finally {
      setBusy(false)
    }
  }

  return <Modal title="Remove from this list" onClose={close}><div className="modal-form">
    <p>Take <strong>{priority.item}</strong> off {phase}'s list? It was carried over{from ? ` from ${from}` : ''}.</p>
    <p className="field-hint">{from || 'The earlier phase'} is not touched, so the item can be carried over again. {awards > 0 ? `${awards === 1 ? 'The award' : `The ${awards} awards`} recorded from it in ${phase} stay${awards === 1 ? 's' : ''} in the Log and in the awards.` : 'Nothing was awarded from it in this phase.'} The removal is logged.</p>
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={close}>Keep it</button><button type="button" className="button button-primary" onClick={remove} disabled={live.feedback.busy}><Trash2 size={15} /> Remove from the list</button></div>
  </div></Modal>
}
