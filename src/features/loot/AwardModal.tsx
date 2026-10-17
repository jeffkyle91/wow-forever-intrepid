import type { FormEvent } from 'react'
import { Check, Shield } from 'lucide-react'
import { createAward, type AwardRecord as Award, type PriorityRecord as LootPriority } from '../../guildApi'
import { coinsArt } from '../../shared/art'
import type { TabContext } from '../../shared/tabs/types'
import { ArtIcon } from '../../shared/ui/ArtIcon'
import { Modal } from '../../shared/ui/Modal'
import { phaseNoOf } from '../../shared/game/phases'
import { listingProgress, nameKey, recipientChoices } from './completion'

// The award snapshot (candidate order and council note at decision time) is built here,
// from the `priority` captured when the modal was opened, never from live data.
export function AwardModal({ priority, awardedAt, close, live }: { priority: LootPriority; awardedAt: string; close: () => void; live: TabContext }) {
  const { setBusy, setMutationError } = live.feedback
  // Offer the first listing that is still open, so a player who already received the item is not the default again.
  const progress = listingProgress(priority, live.data.awards)
  const choices = recipientChoices(priority, progress)
  const nextName = priority.rankedPlayers[progress.next] ?? ''
  const defaultRecipient = choices.find((choice) => nameKey(choice.name) === nameKey(nextName))?.name ?? choices[0]?.name ?? ''

  async function recordAward(event: FormEvent<HTMLFormElement>, priority: LootPriority) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const award: Omit<Award, 'id'> = {
      priorityId: priority.id,
      item: priority.item,
      encounter: priority.encounter,
      recipient: String(data.get('recipient')),
      awardedAt: String(data.get('awardedAt')),
      prioritySnapshot: [...priority.rankedPlayers],
      councilNoteSnapshot: priority.councilNote,
      awardNote: String(data.get('awardNote')).trim(),
      phaseNo: phaseNoOf(priority),
    }
    setBusy(true)
    try {
      await createAward(award)
      setMutationError('')
      close()
      live.navigate('history')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not record loot award.')
    } finally {
      setBusy(false)
    }
  }

  return <Modal title="Record loot award" onClose={close}><div className="award-modal-item"><span className="item-gem"><ArtIcon src={coinsArt} className="loot-art-icon" /></span><span><strong>{priority.item}</strong><small>{priority.encounter}</small></span></div><form className="modal-form" onSubmit={(event) => recordAward(event, priority)}>
    <label>Awarded to<select name="recipient" defaultValue={defaultRecipient} required>{choices.map((choice) => <option key={choice.name} value={choice.name}>{choice.listed > 1 ? `${choice.name} (${choice.received} of ${choice.listed} received)` : choice.received ? `${choice.name} (received)` : choice.name}</option>)}</select></label>
    <label>Award date<input type="date" name="awardedAt" defaultValue={awardedAt} required /></label>
    <label>Council decision note<textarea name="awardNote" rows={3} placeholder="Optional context for the permanent record" /></label>
    <p className="snapshot-callout"><Shield size={15} /> The current priority order and council note will be saved with this award.</p>
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" disabled={live.feedback.busy || priority.rankedPlayers.length === 0}><Check size={15} /> Record award</button></div>
  </form></Modal>
}
