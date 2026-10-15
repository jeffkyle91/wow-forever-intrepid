import type { FormEvent } from 'react'
import { saveGuildRecord, type PlayerRecord as Player } from '../../guildApi'
import type { Role } from '../../shared/game/classes'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'
import { PlayerForm } from './PlayerForm'

export function PlayerModal({ existing, close, live }: { existing?: Player; close: () => void; live: TabContext }) {
  const { setBusy, setMutationError } = live.feedback

  async function savePlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const player: Player = {
      id: existing ? existing.id : crypto.randomUUID(),
      name: String(data.get('name')).trim(),
      surname: String(data.get('surname') ?? '').trim() || undefined,
      className: String(data.get('className')).trim(),
      specialization: String(data.get('specialization')).trim(),
      role: String(data.get('role')) as Role,
      mainId: String(data.get('mainId') ?? '') || undefined,
    }
    setBusy(true)
    try {
      const { id, ...record } = player
      await saveGuildRecord('roster', id, record)
      setMutationError('')
      close()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not save guild member.')
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={existing ? 'Edit member' : 'Add guild member'} onClose={close}><PlayerForm player={existing} roster={live.data.roster} busy={live.feedback.busy} onSubmit={savePlayer} onCancel={close} /></Modal>
}
