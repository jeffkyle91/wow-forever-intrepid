import { useState } from 'react'
import { resolveCharacterRequest } from '../../guildApi'
import type { TabContext } from '../tabs/types'
import { Modal } from '../ui/Modal'
import { characterRequestLabels, requestCharacterName, type CharacterRequest } from './requests'
import { CharacterRequestCharacter } from './CharacterRequestCharacter'
import { Check, Clock3, MessageSquare, ShieldCheck, X } from 'lucide-react'
import './CharacterRequests.css'

const proposalLabels = { name: 'First name', surname: 'Surname', className: 'Class', specialization: 'Specialization', role: 'Default raid role' } as const
const proposalFields = Object.keys(proposalLabels) as (keyof CharacterRequest['proposed'])[]

export function CharacterRequestReviewModal({ requestId, review, close, live }: { requestId: string; review: boolean; close: () => void; live: TabContext }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const request = live.data.characterRequests.find((entry) => entry.id === requestId)
  const canReview = review && live.identity.canEditRoster
  const canWithdraw = !review && request?.userId === live.identity.uid
  const pending = request?.status === 'pending'
  const mainName = request ? live.data.roster.find((character) => character.id === request.mainId)?.name ?? request.mainId : ''
  const requestedName = request?.proposed.name ?? request?.before?.name ?? ''
  const requestedClass = request?.proposed.className ?? request?.before?.className ?? ''
  const requestedSpec = request?.proposed.specialization ?? request?.before?.specialization ?? ''
  async function resolve(action: 'approve' | 'reject' | 'withdraw') {
    if (live.feedback.busy || !request || !pending) return
    live.feedback.setBusy(true)
    try {
      await resolveCharacterRequest(request.id, action, action === 'withdraw' ? '' : note.trim())
      live.feedback.setMutationError('')
      live.feedback.setNotice(`Character-change request ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'withdrawn'}.`)
      close()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not resolve the character request.')
    } finally {
      live.feedback.setBusy(false)
    }
  }
  return <Modal title="Character-change request" onClose={close}>
    <div className="modal-form character-request-detail">
      {request ? <>
        <div className="character-request-summary"><span className="character-request-kicker">Roster change</span><span className={`character-request-status character-request-status-${request.status}`}>{pending ? <Clock3 size={12} /> : <ShieldCheck size={12} />}{request.status}</span><h3>{characterRequestLabels[request.kind]}</h3><p>{request.displayName || 'Guild member'} <span aria-hidden="true">·</span> {request.requestedAt.toDate().toLocaleString()}</p></div>
        <section className="character-request-section" aria-label="Current at submission"><h4>Current at submission</h4>
          {request.before ? <CharacterRequestCharacter {...request.before} label={request.before.mainId ? 'Alt character' : 'Main character'} /> : <p className="character-request-placeholder">New character · not yet on the roster</p>}
          <p className="character-request-caption">Main at submission: {mainName}</p>
        </section>
        <section className="character-request-section character-request-proposed" aria-label="Requested change"><h4>Requested change</h4>
          <CharacterRequestCharacter name={requestedName || requestCharacterName(request)} surname={request.proposed.surname ?? request.before?.surname} className={requestedClass} specialization={requestedSpec} role={request.proposed.role ?? request.before?.role} label={request.kind === 'promote-main' ? 'New main character' : request.kind === 'create-alt' || request.kind === 'link-alt' ? 'Alt character' : 'On approval'} />
          <dl className="character-request-changes">{proposalFields.filter((key) => request.proposed[key] !== undefined && (!request.before || request.before[key] !== request.proposed[key])).map((key) => <div key={key}><dt>{proposalLabels[key]}</dt><dd>{request.before && <span className="character-request-old">{request.before[key] || 'None'} <span aria-label="changes to">→</span> </span>}<span>{request.proposed[key] || 'None'}</span></dd></div>)}</dl>
          {request.kind === 'promote-main' && <p>Moves the account link and makes {mainName} and its other direct alts alts of this character. IDs, team assignments and historical snapshots stay unchanged.</p>}
          {request.kind === 'link-alt' && <p>Links this character as a direct alt of {mainName}. It must still be unlinked and have no alts of its own.</p>}
        </section>
        <section className="character-request-section" aria-label="Member note"><h4><MessageSquare size={13} /> Member note</h4><p className="character-request-note">{request.note || 'No note provided.'}</p></section>
        {pending ? <p className="character-request-safety"><ShieldCheck size={15} /> Approval rechecks ownership and submitted details. Stale requests must be rejected or withdrawn and submitted again.</p> : <section className="character-request-section" aria-label="Decision"><h4><ShieldCheck size={13} /> Decision</h4><p>{request.resolvedByName || 'Guild member'} · {request.resolvedAt?.toDate().toLocaleString()}</p><p className="character-request-note">{request.resolutionNote || 'No resolution note.'}</p></section>}
        {pending && canReview && <section className="character-request-section" aria-label="Guild Leader review"><h4><ShieldCheck size={13} /> Guild Leader review</h4><label>Review note <span className="field-hint">Optional; visible to the requester</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} disabled={live.feedback.busy} placeholder="Add context for your decision..." /></label></section>}
      </> : <p role="alert">This request is no longer available.</p>}
      {error && <p role="alert" className="character-request-error">{error}</p>}
      <div className="modal-actions"><button className="button button-secondary" onClick={close}>Close</button>
        {pending && canWithdraw && <button className="button button-secondary" disabled={live.feedback.busy} onClick={() => resolve('withdraw')}>Withdraw request</button>}
        {pending && canReview && <><button className="button button-secondary character-request-reject" disabled={live.feedback.busy} onClick={() => resolve('reject')}><X size={14} /> Reject request</button><button className="button button-primary" disabled={live.feedback.busy} onClick={() => resolve('approve')}><Check size={14} /> Approve request</button></>}
      </div>
    </div>
  </Modal>
}
