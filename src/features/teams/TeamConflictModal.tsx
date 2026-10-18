import { Modal } from '../../shared/ui/Modal'
import type { TeamAssignmentConflict } from './assignment'

export function TeamConflictModal({ conflict, close }: { conflict: TeamAssignmentConflict; close: () => void }) {
  return <Modal title="Raid Team Conflict" onClose={close}>
    <p className="teams-conflict-description">{conflict.characterName} cannot be assigned to {conflict.teamName} because {conflict.conflictingCharacterName} is already on that team. A main and its alts, or two alts belonging to the same main, cannot share a raid team.</p>
    <div className="modal-actions"><button className="button button-primary" onClick={close}>OK</button></div>
  </Modal>
}