import { setMembershipRemoved } from '../../guildApi'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'
import './MemberAccessModal.css'

export function MemberAccessModal({ uid, restore, close, live }: { uid: string; restore: boolean; close: () => void; live: TabContext }) {
  const member = live.data.members.find((candidate) => candidate.id === uid)
  const changed = !member || (member.role === 'Removed') !== restore
  const { busy, setBusy, setMutationError, setNotice } = live.feedback
  const self = uid === live.identity.uid

  async function confirm() {
    if (changed || self) {
      setMutationError(self ? 'You cannot remove or restore your own guild access.' : 'This account changed. Close this dialog and review its current access.')
      return
    }
    setBusy(true)
    try {
      await setMembershipRemoved(uid, !restore)
      setMutationError('')
      setNotice(restore ? 'Member access restored. Link a character in Member Access before they sign up for raids.' : 'Guild access removed. Characters and historical records were preserved.')
      close()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not change guild access.')
    } finally {
      setBusy(false)
    }
  }

  return <Modal title={restore ? 'Restore guild access' : 'Remove guild access'} onClose={close}>
    <p className="member-access-copy">{restore ? `Confirm restoration of guild access for ${member?.displayName || 'this account'}.` : `Confirm removal of guild access for ${member?.displayName || 'this account'}.`}</p>
    <p className="member-access-copy">{restore ? 'Access will be restored with the Member role. Previous leadership permissions and character links will not be reinstated. A Guild Leader may assign these separately after restoration.' : 'This action revokes access to guild information and removes the linked character association. Characters, team assignments, comments, raid responses and historical records will be retained. Previously viewed or downloaded information cannot be recalled.'}</p>
    <p className="member-access-copy">{restore ? 'The sign-in account is unaffected by this action.' : 'The sign-in account will remain active. Guild access may be restored only by a Guild Leader.'}</p>
    {changed && <p className="member-access-copy" role="alert">The account status has changed. Close this dialog and review the current access settings before proceeding.</p>}
    <div className="modal-actions"><button className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" disabled={busy || changed || self} onClick={confirm}>{restore ? 'Restore as Member' : 'Remove access'}</button></div>
  </Modal>
}
