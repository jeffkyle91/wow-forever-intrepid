import { useState } from 'react'
import type { TabContext } from '../tabs/types'
import { CharacterRequestModal } from './CharacterRequestModal'
import { CharacterRequestReviewModal } from './CharacterRequestReviewModal'
import { characterRequestLabels, requestCharacterName, requestMainName } from './requests'
import './CharacterRequests.css'

export function CharacterRequestsPanel({ ctx, review = false }: { ctx: TabContext; review?: boolean }) {
  const [showHistory, setShowHistory] = useState(false)
  const records = ctx.data.characterRequests.filter((request) => review ? ctx.identity.canEditRoster : request.userId === ctx.identity.uid)
  const pending = records.filter((request) => request.status === 'pending')
  const visible = showHistory ? records : pending
  const main = ctx.data.roster.find((character) => character.linkedUid === ctx.identity.uid && !character.mainId)
  const pendingFirstMain = pending.some((request) => request.kind === 'create-main')
  return <section className={`character-requests-panel${!review && !main ? ' character-requests-first-main' : ''}`} aria-label={review ? 'Character request review' : 'My character requests'}>
    <header><h3>{review ? 'Character requests' : 'My character requests'} <small>{pending.length} pending</small></h3>
      {!review && !ctx.identity.isPreviewing && <button className={`button ${main ? 'button-secondary' : 'button-primary'}`} disabled={ctx.feedback.busy || !ctx.data.characterRequestsLoaded || Boolean(ctx.data.characterRequestsError) || (!main && pendingFirstMain)} onClick={() => ctx.openModal(({ close, live }) => <CharacterRequestModal initialKind={main ? 'rename' : 'create-main'} close={close} live={live} />)}>{main ? 'Request character change' : pendingFirstMain ? 'First-Main Request Pending' : 'Request First Main'}</button>}
    </header>
    <p>{review ? 'Guild Leaders approve changes. Requests and review notes are visible only to their owner and Guild Leaders.' : main ? 'Submit changes for Guild Leader approval. Nothing changes on the roster until approval.' : 'Request a first main character for Guild Leader approval. Submission does not add a character or link your account.'}</p>
    {ctx.data.characterRequestsError && <p role="alert" className="character-request-error">{ctx.data.characterRequestsError}</p>}
    {!ctx.data.characterRequestsLoaded && !ctx.data.characterRequestsError && <p role="status">Loading character requests...</p>}
    <label className="character-request-history"><input type="checkbox" checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)} /> Show resolved requests</label>
    {ctx.data.characterRequestsLoaded && !ctx.data.characterRequestsError && !visible.length && <p>{showHistory ? 'No character requests.' : 'No pending character requests.'}</p>}
    <ul>{visible.map((request) => <li key={request.id}><span><strong>{requestMainName(request, ctx.data.roster)}</strong><small>{characterRequestLabels[request.kind]} · Character: {requestCharacterName(request)} · {request.status}{review ? ` · ${request.displayName || 'Guild member'}` : ''}</small></span><button className="button button-secondary" onClick={() => ctx.openModal(({ close, live }) => <CharacterRequestReviewModal requestId={request.id} review={review} close={close} live={live} />)}>{review && request.status === 'pending' ? 'Review' : 'View request'}</button></li>)}</ul>
  </section>
}
