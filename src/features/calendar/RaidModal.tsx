import type { FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { createRaidEvent, type RaidRecord } from '../../guildApi'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'

export function RaidModal({ date: defaultDate, close, live }: { date: string; close: () => void; live: TabContext }) {
  const { setBusy, setMutationError, setNotice } = live.feedback

  async function saveRaid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const date = String(data.get('date') ?? '')
    const name = String(data.get('name') ?? '').trim()
    const size = Number(data.get('size'))
    if (!live.identity.uid || !date || !name || ![10, 20, 40].includes(size)) {
      setMutationError('Enter a raid name, date, and a valid raid size.')
      return
    }

    setBusy(true)
    try {
      await createRaidEvent({ date, name, size: size as RaidRecord['size'] }, live.identity.uid)
      setMutationError('')
      setNotice('Raid added to the calendar.')
      close()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not add raid.')
    } finally {
      setBusy(false)
    }
  }

  return <Modal title="Add Raid" onClose={close}><form className="modal-form" onSubmit={saveRaid}>
    <label>Raid name<input name="name" placeholder="e.g. Karazhan" maxLength={80} required autoFocus /></label>
    <div className="form-grid"><label>Date<input name="date" type="date" defaultValue={defaultDate} required /></label><label>Raid size<select name="size" defaultValue="10"><option value="10">10-player</option><option value="20">20-player</option><option value="40">40-player</option></select></label></div>
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" disabled={live.feedback.busy}><Plus size={15} /> Add Raid</button></div>
  </form></Modal>
}
