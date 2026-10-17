import { useState, type FormEvent } from 'react'
import { submitCharacterRequest } from '../../guildApi'
import { classSpecializations } from '../game/classes'
import type { TabContext } from '../tabs/types'
import { Modal } from '../ui/Modal'
import { characterRequestLabels, eligibleRequestCharacters, isCharacterRequestKind, type CharacterProposal, type CharacterRequestKind } from './requests'
import './CharacterRequests.css'
import { CharacterRequestCharacter } from './CharacterRequestCharacter'

export function CharacterRequestModal({ close, live }: { close: () => void; live: TabContext }) {
  const [kind, setKind] = useState<CharacterRequestKind>('rename')
  const [characterId, setCharacterId] = useState('')
  const candidates = eligibleRequestCharacters(live.data.roster, live.identity.uid, kind)
  const selected = candidates.find((character) => character.id === characterId) ?? candidates[0]
  return <Modal title="Request a character change" onClose={close}>
    <div className="character-request-intro"><p>Guild Leaders review every request before any roster details change. Character IDs, team assignments and historical snapshots stay unchanged.</p></div>
    <label className="character-request-choice">Change type<select value={kind} disabled={live.feedback.busy} onChange={(event) => { if (isCharacterRequestKind(event.target.value)) { setKind(event.target.value); setCharacterId('') } }}>{Object.entries(characterRequestLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {kind !== 'create-alt' && <label className="character-request-choice">Character<select value={selected?.id ?? ''} disabled={live.feedback.busy || !candidates.length} onChange={(event) => setCharacterId(event.target.value)}>{!candidates.length && <option value="">No eligible characters</option>}{candidates.map((character) => <option key={character.id} value={character.id}>{character.name} · {character.specialization} {character.className}</option>)}</select></label>}
    {kind !== 'create-alt' && selected && <CharacterRequestCharacter {...selected} label="Current character" />}
    <RequestForm key={`${kind}:${kind === 'create-alt' ? '' : selected?.id ?? ''}`} kind={kind} selectedId={kind === 'create-alt' ? undefined : selected?.id} close={close} live={live} />
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
    if (busy) return
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    const surname = String(form.get('surname') ?? '').trim()
    let proposal: CharacterProposal
    if (kind === 'create-alt') proposal = { kind, characterId: null, proposed: { name, surname, className, specialization } }
    else if (!selectedId) { setError('Choose an eligible character.'); return }
    else if (kind === 'rename') proposal = { kind, characterId: selectedId, proposed: { name, surname } }
    else if (kind === 'change-spec') proposal = { kind, characterId: selectedId, proposed: { className, specialization } }
    else proposal = { kind, characterId: selectedId, proposed: {} }
    live.feedback.setBusy(true)
    try {
      await submitCharacterRequest(requestId, proposal, String(form.get('note') ?? '').trim())
      live.feedback.setMutationError('')
      live.feedback.setNotice('Character-change request submitted for Guild Leader review.')
      close()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not submit the character request.')
    } finally {
      live.feedback.setBusy(false)
    }
  }

  return <form className={`modal-form character-request-form character-request-form-${kind}`} onSubmit={submit}>
    <fieldset disabled={busy || !main || (kind !== 'create-alt' && !selectedId)}>
      <legend>Requested change</legend>
      {(kind === 'create-alt' || kind === 'rename') && <div className="form-grid"><label>First name<input name="name" defaultValue={character?.name ?? ''} maxLength={30} required /></label><label>Surname (optional)<input name="surname" defaultValue={character?.surname ?? ''} maxLength={30} /></label></div>}
      {kind === 'rename' && <p>Historical loot entries keep their original names. Older name-only records may not match your dashboard after a rename; they are not deleted or rewritten.</p>}
      {(kind === 'create-alt' || kind === 'change-spec') && <><div className="form-grid"><label>Class<select value={className} onChange={(event) => { setClassName(event.target.value); setSpecialization(classSpecializations[event.target.value][0].name) }}>{Object.keys(classSpecializations).map((name) => <option key={name}>{name}</option>)}</select></label><label>Specialization<select value={specialization} onChange={(event) => setSpecialization(event.target.value)}>{classSpecializations[className].map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label></div><CharacterRequestCharacter name={character?.name ?? 'New alt'} className={className} specialization={specialization} role={spec.role} label="On approval" /><p>Raid role follows the approved specialization. Guild Leaders retain their manual override; there is no separate role-change request.</p></>}
      {kind === 'link-alt' && <p>The character must have no account link, main or alts of its own. Approval links it as a direct alt of {main?.name}.</p>}
      {kind === 'promote-main' && <p>Approval moves your account link to this alt. {main?.name} and its other direct alts become alts of the new main. Team assignments and historical records do not move or change.</p>}
    </fieldset>
    <label className="character-request-section">Note for Guild Leaders <span className="field-hint">Optional</span><textarea name="note" maxLength={500} rows={3} disabled={busy} placeholder="Tell leaders why you are requesting this change..." /></label>
    {error && <p role="alert" className="character-request-error">{error}</p>}
    {!main && <p role="alert">Your main character link is no longer available. Ask a Guild Leader to check it.</p>}
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" disabled={busy || !main || (kind !== 'create-alt' && !selectedId)}>Submit request</button></div>
  </form>
}
