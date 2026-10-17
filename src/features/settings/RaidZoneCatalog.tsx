import { useState, type FormEvent } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { deleteRaidZone, saveRaidZone, type RaidSize, type RaidZoneRecord } from '../../guildApi'
import type { TabContext } from '../../shared/tabs/types'

const sizes: RaidSize[] = [10, 20, 40]

export function RaidZoneCatalog({ zones, ctx }: { zones: RaidZoneRecord[]; ctx: TabContext }) {
  const { busy, setBusy, setMutationError, setNotice } = ctx.feedback
  const [name, setName] = useState('')
  const [size, setSize] = useState<RaidSize>(10)

  async function addZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) return
    setBusy(true)
    try {
      await saveRaidZone({ name: cleanName, size })
      setName('')
      setMutationError('')
      setNotice('Raid zone added.')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not add raid zone.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="settings-section">
    <header><h3>Raid zones</h3><p>Choose one or more zones when scheduling a raid night. The selected zone names and sizes are saved with the raid, so catalog changes do not alter scheduled raids.</p></header>
    {zones.map((zone) => <RaidZoneRow key={zone.id} zone={zone} ctx={ctx} />)}
    <form className="raid-zone-add" onSubmit={(event) => void addZone(event)}>
      <label className="settings-field">Zone name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required disabled={busy} /></label>
      <label className="settings-field">Player size<select value={size} onChange={(event) => setSize(Number(event.target.value) as RaidSize)} disabled={busy}>{sizes.map((option) => <option key={option} value={option}>{option}-player</option>)}</select></label>
      <button className="button button-secondary" disabled={busy || !name.trim()}><Plus size={14} /> Add zone</button>
    </form>
  </section>
}

function RaidZoneRow({ zone, ctx }: { zone: RaidZoneRecord; ctx: TabContext }) {
  const { busy, setBusy, setMutationError, setNotice } = ctx.feedback
  const [name, setName] = useState(zone.name)
  const [size, setSize] = useState<RaidSize>(zone.size)
  const changed = name.trim() !== zone.name || size !== zone.size

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) return
    setBusy(true)
    try {
      await saveRaidZone({ name: cleanName, size }, zone.id)
      setMutationError('')
      setNotice('Raid zone updated.')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not update raid zone.')
    } finally {
      setBusy(false)
    }
  }

  return <form className="raid-zone-row" onSubmit={(event) => void save(event)}>
    <label className="settings-field">Zone name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required disabled={busy} /></label>
    <label className="settings-field">Player size<select value={size} onChange={(event) => setSize(Number(event.target.value) as RaidSize)} disabled={busy}>{sizes.map((option) => <option key={option} value={option}>{option}-player</option>)}</select></label>
    <button className="button button-secondary" disabled={busy || !changed || !name.trim()}><Save size={14} /> Save</button>
    <button type="button" className="button button-secondary" disabled={busy} aria-label={`Remove ${zone.name}`} onClick={() => void removeRaidZone(zone, ctx)}><Trash2 size={14} /> Remove</button>
  </form>
}

async function removeRaidZone(zone: RaidZoneRecord, ctx: TabContext) {
  const { setBusy, setMutationError, setNotice } = ctx.feedback
  setBusy(true)
  try {
    await deleteRaidZone(zone.id)
    setMutationError('')
    setNotice(`${zone.name} removed from the zone catalog. Scheduled raids keep their saved zone details.`)
  } catch (error) {
    setMutationError(error instanceof Error ? error.message : 'Could not remove raid zone.')
  } finally {
    setBusy(false)
  }
}
