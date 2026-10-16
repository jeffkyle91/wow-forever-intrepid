import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { DEFAULT_RAID_TIME, RAID_DESCRIPTION_MAX_LENGTH, createRaidEvent, type RaidRecord } from '../../guildApi'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'
import { RaidZonePicker } from './RaidZonePicker'
import { TimePicker } from './TimePicker'

export function RaidModal({ date: defaultDate, close, live }: { date: string; close: () => void; live: TabContext }) {
  const { setBusy, setMutationError, setNotice } = live.feedback
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([])

  async function saveRaid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const date = String(data.get('date') ?? '')
    const name = String(data.get('name') ?? '').trim()
    const description = String(data.get('description') ?? '').trim()
    const time = String(data.get('time') ?? '')
    const zones = selectedZoneIds.map((id) => live.data.raidZones.find((zone) => zone.id === id)).filter((zone) => zone !== undefined)
    if (!live.identity.uid || !date || !time || !name || !zones.length || zones.length !== selectedZoneIds.length) {
      setMutationError('Enter a raid name and date, and select at least one configured zone.')
      return
    }

    setBusy(true)
    try {
      const size = Math.max(...zones.map((zone) => zone.size)) as RaidRecord['size']
      await createRaidEvent({ date, time, name, size, zones, ...(description ? { description } : {}) }, live.identity.uid)
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
    <label>Raid night name<input name="name" placeholder="e.g. Tuesday raid night" maxLength={80} required autoFocus /></label>
    <div className="form-grid"><label>Date<input name="date" type="date" defaultValue={defaultDate} required /></label></div>
    <div className="time-picker-field"><span>Start time (ET)</span><TimePicker name="time" defaultValue={DEFAULT_RAID_TIME} /></div>
    <RaidZonePicker zones={live.data.raidZones} selectedIds={selectedZoneIds} onChange={setSelectedZoneIds} />
    <label>Description (optional)<textarea name="description" rows={3} maxLength={RAID_DESCRIPTION_MAX_LENGTH} placeholder="e.g. Bring flasks. Summons at 7:45 pm." /></label>
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" disabled={live.feedback.busy}><Plus size={15} /> Add Raid</button></div>
  </form></Modal>
}
