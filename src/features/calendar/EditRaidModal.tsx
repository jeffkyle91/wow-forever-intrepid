import { useState, type FormEvent } from 'react'
import { Ban, RotateCcw, Save } from 'lucide-react'
import { RAID_DESCRIPTION_MAX_LENGTH, RAID_REASON_MAX_LENGTH, cancelRaidEvent, isRaidCancelled, raidTimeOf, restoreRaidEvent, updateRaidEvent, type RaidRecord } from '../../guildApi'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'

export function EditRaidModal({ raidId, close, live }: { raidId: string; close: () => void; live: TabContext }) {
  const { busy, setBusy, setMutationError, setNotice } = live.feedback
  const raid = live.data.raids.find((candidate) => candidate.id === raidId)
  const [reason, setReason] = useState('')

  if (!raid) return <Modal title="Edit Raid" onClose={close}><p className="raid-modal-note">This raid is no longer on the calendar.</p><div className="modal-actions"><button type="button" className="button button-secondary" onClick={close}>Close</button></div></Modal>

  const who = { uid: live.identity.uid, displayName: live.identity.displayName }
  const cancelled = isRaidCancelled(raid)

  async function run(work: () => Promise<void>, done: string, fallback: string) {
    setBusy(true)
    try {
      await work()
      setMutationError('')
      setNotice(done)
      close()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : fallback)
    } finally {
      setBusy(false)
    }
  }

  function saveRaid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const date = String(data.get('date') ?? '')
    const name = String(data.get('name') ?? '').trim()
    const size = Number(data.get('size'))
    const description = String(data.get('description') ?? '')
    const time = String(data.get('time') ?? '')
    if (!who.uid || !date || !time || !name || ![10, 20, 40].includes(size)) {
      setMutationError('Enter a raid name, date, and a valid raid size.')
      return
    }
    void run(() => updateRaidEvent(raid as RaidRecord, { date, time, name, size: size as RaidRecord['size'], description }, who), 'Raid updated.', 'Could not update raid.')
  }

  return <Modal title="Edit Raid" onClose={close}>
    <form className="modal-form" onSubmit={saveRaid}>
      {cancelled && <p className="raid-modal-note"><strong>Cancelled:</strong> {raid.cancelReason}</p>}
      <label>Raid name<input name="name" defaultValue={raid.name} maxLength={80} required autoFocus /></label>
      <div className="form-grid"><label>Date<input name="date" type="date" defaultValue={raid.date} required /></label><label>Start time (ET)<input name="time" type="time" defaultValue={raidTimeOf(raid)} required /></label></div>
      <div className="form-grid"><label>Raid size<select name="size" defaultValue={String(raid.size)}><option value="10">10-player</option><option value="20">20-player</option><option value="40">40-player</option></select></label></div>
      <label>Description (optional)<textarea name="description" rows={3} defaultValue={raid.description ?? ''} maxLength={RAID_DESCRIPTION_MAX_LENGTH} /></label>
      <div className="modal-actions"><button type="button" className="button button-secondary" onClick={close}>Close</button><button className="button button-primary" disabled={busy}><Save size={15} /> Save changes</button></div>
    </form>
    <div className="modal-form raid-cancel-section">
      {cancelled
        ? <div className="modal-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => void run(() => restoreRaidEvent(raid, who), 'Raid restored.', 'Could not restore raid.')}><RotateCcw size={15} /> Restore raid</button></div>
        : <>
          <label>Reason for cancelling<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={RAID_REASON_MAX_LENGTH} placeholder="e.g. Not enough tanks" /></label>
          <div className="modal-actions"><button type="button" className="button button-secondary raid-cancel-button" disabled={busy || !reason.trim()} onClick={() => void run(() => cancelRaidEvent(raid, reason, who), 'Raid cancelled.', 'Could not cancel raid.')}><Ban size={15} /> Cancel raid</button></div>
        </>}
    </div>
  </Modal>
}
