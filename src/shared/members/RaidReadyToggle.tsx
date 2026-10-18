import { setCharacterReadiness } from '../../guildApi'
import type { TabContext } from '../tabs/types'
import { Modal } from '../ui/Modal'
import './RaidReadyToggle.css'

export function RaidReadyToggle({ characterId, name, ctx }: { characterId: string; name: string; ctx: TabContext }) {
  const { readiness, readinessLoaded, readinessError } = ctx.data
  const ready = readiness.some((entry) => entry.id === characterId && entry.ready)
  const main = ctx.data.roster.find((character) => character.linkedUid === ctx.identity.uid && !character.mainId)
  const character = ctx.data.roster.find((entry) => entry.id === characterId)
  if (!ctx.identity.canEditRoster && (!main || !character || (character.id !== main.id && (character.mainId !== main.id || character.linkedUid)))) return null
  return <label className="raid-ready-toggle"><input type="checkbox" checked={ready} disabled={ctx.feedback.busy || !readinessLoaded || !!readinessError} onChange={(event) => {
    const next = event.target.checked
    ctx.openModal(({ close, live }) => <ReadinessConfirmation characterId={characterId} name={name} next={next} close={close} live={live} />)
  }} aria-label={`Raid ready: ${name}`} /> Raid ready{!readinessLoaded && !readinessError ? ' (loading)' : ''}</label>
}

function ReadinessConfirmation({ characterId, name, next, close, live }: { characterId: string; name: string; next: boolean; close: () => void; live: TabContext }) {
  const { busy, setBusy, setMutationError, setNotice } = live.feedback
  async function confirm() {
    if (busy) return
    setBusy(true)
    try {
      await setCharacterReadiness(characterId, next)
      setMutationError('')
      setNotice(`${name} marked ${next ? 'raid ready' : 'not raid ready'}.`)
      close()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not save raid readiness.')
    } finally {
      setBusy(false)
    }
  }
  return <Modal title={`Confirm raid readiness: ${name}`} onClose={close}>
    <p className="raid-ready-confirmation-copy">{next ? 'Please confirm this character is raid ready. This means talents, gear, keys, and attunes are all appropriate for raids.' : 'Confirm you are marking this character as not ready for raid.'}</p>
    <div className="modal-actions"><button className="button button-secondary" disabled={busy} onClick={close}>Cancel</button><button className="button button-primary" disabled={busy || !live.data.readinessLoaded || !!live.data.readinessError} onClick={() => void confirm()}>Confirm</button></div>
  </Modal>
}
