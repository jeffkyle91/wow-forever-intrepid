import { useState, type FormEvent } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { createAfkEntry, deleteAfkEntry, updateAfkEntry, type AfkEntryRecord } from '../../guildApi'
import type { TabContext } from '../tabs/types'
import { Modal } from '../ui/Modal'
import './AbsenceModal.css'

export function AbsenceModal({ today, entry, close, live }: { today?: string; entry?: AfkEntryRecord; close: () => void; live: TabContext }) {
  const { setBusy, setMutationError, setNotice } = live.feedback
  const [error, setError] = useState('')
  const current = entry ? live.data.afkEntries.find((value) => value.id === entry.id) : undefined
  const canSave = !entry || current?.userId === live.identity.uid

  async function removeAbsence() {
    if (live.feedback.busy) return
    if (!entry || !canSave) {
      const message = 'This unavailable entry no longer exists or is not yours to delete.'
      setError(message)
      setMutationError(message)
      return
    }
    setError('')
    setBusy(true)
    try {
      await deleteAfkEntry(entry.id)
      setMutationError('')
      setNotice('Unavailable dates removed.')
      close()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not remove unavailable dates.'
      setError(message)
      setMutationError(message)
    } finally {
      setBusy(false)
    }
  }

  async function saveAbsence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (live.feedback.busy) return
    if (!canSave) {
      setError('This unavailable entry no longer exists or is not yours to edit.')
      setMutationError('This unavailable entry no longer exists or is not yours to edit.')
      return
    }
    const data = new FormData(event.currentTarget)
    const startDate = String(data.get('startDate') ?? '')
    const endDate = String(data.get('endDate') ?? '')
    if (!live.identity.uid || !startDate || !endDate || endDate < startDate) {
      setError('Enter a start date and an end date on or after it.')
      setMutationError('Enter a start date and an end date on or after it.')
      return
    }

    setError('')
    setBusy(true)
    try {
      if (entry) await updateAfkEntry(entry.id, { startDate, endDate })
      else await createAfkEntry({ userId: live.identity.uid, displayName: live.identity.displayName, startDate, endDate })
      setMutationError('')
      setNotice(entry ? 'Unavailable dates updated.' : 'Unavailable dates added.')
      close()
    } catch (error) {
      const message = error instanceof Error ? error.message : entry ? 'Could not update unavailable dates.' : 'Could not add unavailable dates.'
      setError(message)
      setMutationError(message)
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={entry ? 'Edit absence' : 'Add absence'} onClose={close}><form className="modal-form absence-modal" onSubmit={saveAbsence}>
    <div className="form-grid">
      <label>Date from<input name="startDate" type="date" defaultValue={entry?.startDate ?? today} disabled={live.feedback.busy} required autoFocus /></label>
      <label>Date to<input name="endDate" type="date" defaultValue={entry?.endDate ?? today} disabled={live.feedback.busy} required /></label>
    </div>
    {entry && <p>Previously affected raids stay Absent. After saving or deleting, you can change your response if no unavailable dates still overlap. Team placements are not restored automatically.</p>}
    {error && <p role="alert">{error}</p>}
    {!canSave && <p role="alert">This unavailable entry no longer exists or is not yours to edit.</p>}
    <div className="modal-actions">
      {entry && <button type="button" className="button button-secondary" disabled={live.feedback.busy || !canSave} onClick={() => void removeAbsence()}><Trash2 size={15} /> Delete absence</button>}
      <button type="button" className="button button-secondary" onClick={close}>Cancel</button>
      <button className="button button-primary" disabled={live.feedback.busy || !canSave}>{entry ? <Save size={15} /> : <Plus size={15} />} {entry ? 'Save changes' : 'Add absence'}</button>
    </div>
  </form></Modal>
}
