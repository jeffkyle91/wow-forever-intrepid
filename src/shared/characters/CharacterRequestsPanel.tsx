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
  return <section className="character-requests-panel" aria-label={review ? 'Character request review' : 'My character requests'}>
    <header><h3>{review ? 'Character requests' : 'My character requests'} <small>{pending.length} pending</small></h3>
      {!review && <button className="button button-secondary" disabled={ctx.feedback.busy || !main} onClick={() => ctx.openModal(({ close, live }) => <CharacterRequestModal close={close} live={live} />)}>Request character change</button>}
    </header>
    <p>{review ? 'Guild Leaders approve changes. Requests and review notes are visible only to their owner and Guild Leaders.' : 'Submit changes for Guild Leader approval. Nothing changes on the roster until approval.'}</p>
    {ctx.data.characterRequestsError && <p role="alert" className="character-request-error">{ctx.data.characterRequestsError}</p>}
    {!ctx.data.characterRequestsLoaded && !ctx.data.characterRequestsError && <p role="status">Loading character requests...</p>}
    <label className="character-request-history"><input type="checkbox" checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)} /> Show resolved requests</label>
    {ctx.data.characterRequestsLoaded && !ctx.data.characterRequestsError && !visible.length && <p>{showHistory ? 'No character requests.' : 'No pending character requests.'}</p>}
    <ul>{visible.map((request) => <li key={request.id}><span><strong>{requestMainName(request, ctx.data.roster)}</strong><small>{characterRequestLabels[request.kind]} · Character: {requestCharacterName(request)} · {request.status}{review ? ` · ${request.displayName || 'Guild member'}` : ''}</small></span><button className="button button-secondary" onClick={() => ctx.openModal(({ close, live }) => <CharacterRequestReviewModal requestId={request.id} review={review} close={close} live={live} />)}>{review && request.status === 'pending' ? 'Review' : 'View request'}</button></li>)}</ul>
  </section>
}
