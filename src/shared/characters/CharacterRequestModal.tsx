import { useState, type FormEvent } from 'react'
import { submitCharacterRequest } from '../../guildApi'
import { classSpecializations } from '../game/classes'
import type { TabContext } from '../tabs/types'
import { Modal } from '../ui/Modal'
import { characterRequestLabels, eligibleRequestCharacters, isCharacterRequestKind, type CharacterProposal, type CharacterRequestKind } from './requests'
import './CharacterRequests.css'
import { CharacterRequestCharacter } from './CharacterRequestCharacter'

export function CharacterRequestModal({ initialKind = 'rename', close, live }: { initialKind?: CharacterRequestKind; close: () => void; live: TabContext }) {
  const [kind, setKind] = useState<CharacterRequestKind>(initialKind)
  const [characterId, setCharacterId] = useState('')
  const main = live.data.roster.find((entry) => entry.linkedUid === live.identity.uid && !entry.mainId)
  const candidates = eligibleRequestCharacters(live.data.roster, live.identity.uid, kind)
  const selected = candidates.find((character) => character.id === characterId) ?? candidates[0]
  const choices = Object.entries(characterRequestLabels).filter(([value]) => main ? value !== 'create-main' : value === 'create-main')
  return <Modal title={kind === 'create-main' ? 'Request your first main character' : 'Request a character change'} onClose={close}>
    <div className="character-request-intro"><p>{kind === 'create-main' ? 'Guild Leaders review every request before a character is added or linked to your account.' : 'Guild Leaders review every request before any roster details change. Character IDs, team assignments and historical snapshots stay unchanged.'}</p></div>
    {choices.length > 1 && <label className="character-request-choice">Change type<select value={kind} disabled={live.feedback.busy} onChange={(event) => { if (isCharacterRequestKind(event.target.value)) { setKind(event.target.value); setCharacterId('') } }}>{choices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
    {!['create-main', 'create-alt'].includes(kind) && <label className="character-request-choice">Character<select value={selected?.id ?? ''} disabled={live.feedback.busy || !candidates.length} onChange={(event) => setCharacterId(event.target.value)}>{!candidates.length && <option value="">No eligible characters</option>}{candidates.map((character) => <option key={character.id} value={character.id}>{character.name} · {character.specialization} {character.className}</option>)}</select></label>}
    {!['create-main', 'create-alt'].includes(kind) && selected && <CharacterRequestCharacter {...selected} label="Current character" />}
    <RequestForm key={`${kind}:${['create-main', 'create-alt'].includes(kind) ? '' : selected?.id ?? ''}`} kind={kind} selectedId={['create-main', 'create-alt'].includes(kind) ? undefined : selected?.id} close={close} live={live} />
  </Modal>
}

function RequestForm({ kind, selectedId, close, live }: { kind: CharacterRequestKind; selectedId?: string; close: () => void; live: TabContext }) {
  const character = live.data.roster.find((entry) => entry.id === selectedId)
  const [requestId] = useState(() => crypto.randomUUID())
  const [className, setClassName] = useState(character && Object.hasOwn(classSpecializations, character.className) ? character.className : 'Warrior')
  const [specialization, setSpecialization] = useState(() => classSpecializations[className].some((spec) => spec.name === character?.specialization) ? character!.specialization : classSpecializations[className][0].name)
  const [error, setError] = useState('')
  const main = live.data.roster.find((entry) => entry.linkedUid === live.identity.uid && !entry.mainId)
  const busy = live.feedback.busy
  const spec = classSpecializations[className].find((entry) => entry.name === specialization)!

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (live.identity.isPreviewing) { setError('Requests cannot be submitted while VIEW AS is active.'); return }
    if (busy) return
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    const surname = String(form.get('surname') ?? '').trim()
    let proposal: CharacterProposal
    if (kind === 'create-main' || kind === 'create-alt') proposal = { kind, characterId: null, proposed: { name, surname, className, specialization } }
    else if (!selectedId) { setError('Choose an eligible character.'); return }
    else if (kind === 'rename') proposal = { kind, characterId: selectedId, proposed: { name, surname } }
    else if (kind === 'change-spec') proposal = { kind, characterId: selectedId, proposed: { className, specialization } }
    else proposal = { kind, characterId: selectedId, proposed: {} }
    live.feedback.setBusy(true)
    try {
      await submitCharacterRequest(requestId, proposal, String(form.get('note') ?? '').trim())
      live.feedback.setMutationError('')
      live.feedback.setNotice(`${kind === 'create-main' ? 'First-main' : 'Character-change'} request submitted for Guild Leader review.`)
      close()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not submit the character request.')
    } finally {
      live.feedback.setBusy(false)
    }
  }

  return <form className={`modal-form character-request-form character-request-form-${kind}`} onSubmit={submit}>
    <fieldset disabled={busy || live.identity.isPreviewing || (kind === 'create-main' ? Boolean(main) : !main) || (!['create-main', 'create-alt'].includes(kind) && !selectedId)}>
      <legend>{kind === 'create-main' ? 'Requested main character' : 'Requested change'}</legend>
      {(['create-main', 'create-alt', 'rename'].includes(kind)) && <div className="form-grid"><label>First name<input name="name" defaultValue={character?.name ?? ''} maxLength={30} required /></label><label>Surname (optional)<input name="surname" defaultValue={character?.surname ?? ''} maxLength={30} /></label></div>}
      {kind === 'rename' && <p>Historical loot entries keep their original names. Older name-only records may not match your dashboard after a rename; they are not deleted or rewritten.</p>}
      {(['create-main', 'create-alt', 'change-spec'].includes(kind)) && <><div className="form-grid"><label>Class<select value={className} onChange={(event) => { setClassName(event.target.value); setSpecialization(classSpecializations[event.target.value][0].name) }}>{Object.keys(classSpecializations).map((name) => <option key={name}>{name}</option>)}</select></label><label>Specialization<select value={specialization} onChange={(event) => setSpecialization(event.target.value)}>{classSpecializations[className].map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label></div><CharacterRequestCharacter name={character?.name ?? (kind === 'create-main' ? 'New main' : 'New alt')} className={className} specialization={specialization} role={spec.role} label="On approval" /><p>Raid role follows the approved specialization.</p></>}
      {kind === 'link-alt' && <p>The character must have no account link, main or alts of its own. Approval links it as a direct alt of {main?.name}.</p>}
      {kind === 'promote-main' && <p>Approval moves your account link to this alt. {main?.name} and its other direct alts become alts of the new main. Team assignments and historical records do not move or change.</p>}
    </fieldset>
    <label className="character-request-section">Note for Guild Leaders <span className="field-hint">Optional</span><textarea name="note" maxLength={500} rows={3} disabled={busy} placeholder="Tell leaders why you are requesting this change..." /></label>
    {error && <p role="alert" className="character-request-error">{error}</p>}
    {!main && kind !== 'create-main' && <p role="alert">Your main character link is no longer available. Ask a Guild Leader to check it.</p>}
    {kind === 'create-main' && <p>Submitting does not add a character or link your account. A Guild Leader must approve the request first.</p>}
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" disabled={busy || live.identity.isPreviewing || (kind === 'create-main' ? Boolean(main) : !main) || (!['create-main', 'create-alt'].includes(kind) && !selectedId)}>Submit request</button></div>
  </form>
}
