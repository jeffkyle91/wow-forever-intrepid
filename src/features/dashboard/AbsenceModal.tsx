import type { FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { createAfkEntry } from '../../guildApi'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'

export function AbsenceModal({ today, close, live }: { today: string; close: () => void; live: TabContext }) {
  const { setBusy, setMutationError, setNotice } = live.feedback

  async function saveAbsence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const startDate = String(data.get('startDate') ?? '')
    const endDate = String(data.get('endDate') ?? '')
    if (!live.identity.uid || !startDate || !endDate || endDate < startDate) {
      setMutationError('Enter a start date and an end date on or after it.')
      return
    }

    setBusy(true)
    try {
      await createAfkEntry({ userId: live.identity.uid, displayName: live.identity.displayName, startDate, endDate })
      setMutationError('')
      setNotice('Unavailable dates added.')
      close()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not add unavailable dates.')
    } finally {
      setBusy(false)
    }
  }

  return <Modal title="Add absence" onClose={close}><form className="modal-form" onSubmit={saveAbsence}>
    <div className="form-grid">
      <label>Date from<input name="startDate" type="date" defaultValue={today} required autoFocus /></label>
      <label>Date to<input name="endDate" type="date" defaultValue={today} required /></label>
    </div>
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" disabled={live.feedback.busy}><Plus size={15} /> Add absence</button></div>
  </form></Modal>
}
