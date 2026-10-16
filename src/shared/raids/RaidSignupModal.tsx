import { useEffect, useState, type FormEvent } from 'react'
import { formatRaidTime, isRaidCancelled, raidTimeOf, type PlayerRecord } from '../../guildApi'
import { saveRaidSignup, signupLabels, signupStatuses, subscribeRaidSignups, type RaidSignup, type SignupStatus } from '../../raidSignups'
import type { TabContext } from '../tabs/types'
import { Modal } from '../ui/Modal'
import { raidPreviewGroups, signupCharacters } from './roster'
import './RaidSignup.css'

export function RaidSignupModal({ raidId, close, live, onEdit }: { raidId: string; close: () => void; live: TabContext; onEdit?: () => void }) {
  const [signups, setSignups] = useState<RaidSignup[] | null>(null)
  const [readError, setReadError] = useState('')
  const [now, setNow] = useState(Date.now)
  useEffect(() => subscribeRaidSignups(raidId, (records) => { setSignups(records); setReadError('') }, (error) => {
    setSignups(null)
    setReadError(`Could not load raid sign-ups: ${error.message}`)
  }), [raidId])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const raid = live.data.raids.find((entry) => entry.id === raidId)
  if (!raid) return <Modal title="Raid sign-ups" onClose={close}><p className="modal-form">This raid is no longer available.</p></Modal>

  const characters = signupCharacters(live.data.roster, live.identity.uid)
  const mine = signups?.find((signup) => signup.id === live.identity.uid)
  const closed = isRaidCancelled(raid) ? 'This raid is cancelled. Sign-ups are closed.'
    : !raid.startsAt ? 'Sign-ups are not enabled for this older raid. Ask a leader to open Edit raid and save its details once.'
      : raid.startsAt.toMillis() <= now ? 'The raid has started. Sign-up changes are closed.' : ''
  const groups = raidPreviewGroups(raid, live.data.settings)
  const responseFor = (player: PlayerRecord) => {
    const response = signups?.find((entry) => entry.characterId === player.id)
    if (response) return signupLabels[response.status]
    const other = player.linkedUid ? signups?.find((entry) => entry.id === player.linkedUid) : undefined
    return other ? `Responded as ${live.data.roster.find((entry) => entry.id === other.characterId)?.name ?? 'another character'}` : 'No response'
  }

  return <Modal title={raid.name} onClose={close}>
    <div className="raid-signup">
      <p>{raid.date} · {formatRaidTime(raidTimeOf(raid))}</p>
      {raid.description && <p>{raid.description}</p>}
      {raid.zones?.length && <p>{raid.zones.map((zone) => `${zone.name} (${zone.size}-player)`).join(' · ')}</p>}
      {onEdit && live.identity.canEditRaidData && <button className="button button-secondary" disabled={live.feedback.busy} onClick={onEdit}>Edit raid</button>}
      {closed && <p role="status">{closed}</p>}
      {readError ? <p role="alert">{readError}</p> : signups === null ? <p role="status">Loading sign-ups…</p> : <>
        {mine && <p role="status">Your saved response: <strong>{signupLabels[mine.status]}</strong> · {live.data.roster.find((player) => player.id === mine.characterId)?.name ?? 'Character no longer on roster'}</p>}
        {characters.length ? <SignupForm key={`${live.identity.uid}:${mine?.characterId ?? ''}:${mine?.status ?? ''}`} raidId={raidId} live={live} characters={characters} mine={mine} closed={Boolean(closed)} />
          : <p>A Guild Leader must link your account to a main character before you can sign up.</p>}
        <h3>Raid team preview</h3>
        <p>Current Raid Teams assignments, not confirmed seats or an attendance record. No starting roster is saved yet; this preview continues to reflect team changes after start. Automatic snapshots come later.</p>
        {groups.map((group) => {
          const players = live.data.roster.filter((player) => group.parts.includes(live.data.assignments[player.id])).sort((a, b) => a.name.localeCompare(b.name))
          const accepted = signups.filter((entry) => ['accept', 'late'].includes(entry.status) && players.some((player) => player.id === entry.characterId)).length
          return <section className="raid-signup-group" key={group.key}>
            <h4>{group.name} ({group.size}-player)</h4>
            <p>{players.length} assigned · {accepted} Accept/Late responses · {group.size} places per zone</p>
            {players.length ? <ul>{players.map((player) => <li key={player.id}><span>{player.name} · {player.role}</span><strong>{responseFor(player)}</strong></li>)}</ul> : <p>No characters assigned.</p>}
          </section>
        })}
        <h4>Responses without a current team</h4>
        {signups.filter((entry) => !live.data.assignments[entry.characterId]).length
          ? <ul>{signups.filter((entry) => !live.data.assignments[entry.characterId]).map((entry) => <li key={entry.id}><span>{live.data.roster.find((player) => player.id === entry.characterId)?.name ?? 'Character no longer on roster'}</span><strong>{signupLabels[entry.status]} · Unassigned</strong></li>)}</ul>
          : <p>None.</p>}
      </>}
      <div className="modal-actions"><button className="button button-secondary" onClick={close}>Close</button></div>
    </div>
  </Modal>
}

function SignupForm({ raidId, live, characters, mine, closed }: { raidId: string; live: TabContext; characters: PlayerRecord[]; mine?: RaidSignup; closed: boolean }) {
  const [characterId, setCharacterId] = useState(mine?.characterId ?? characters[0].id)
  const [status, setStatus] = useState<SignupStatus>(mine?.status ?? 'accept')
  const [error, setError] = useState('')
  const { busy, setBusy, setNotice, setMutationError } = live.feedback
  const characterValid = characters.some((player) => player.id === characterId)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || closed) return
    if (!characterValid) { setError('Choose one of your currently linked characters.'); return }
    setBusy(true)
    setError('')
    try {
      await saveRaidSignup(raidId, live.identity.uid, characterId, status)
      setMutationError('')
      setNotice('Raid response saved.')
    } catch (failure) {
      const message = `Could not save your response. The raid may have started or your character link may have changed. ${failure instanceof Error ? failure.message : 'Try again.'}`
      setError(message)
      setMutationError(message)
    } finally {
      setBusy(false)
    }
  }

  return <form className="raid-signup-form" onSubmit={(event) => void save(event)}>
    <label>Character<select value={characterId} onChange={(event) => setCharacterId(event.target.value)} disabled={busy || closed}>
      {!characterValid && <option value={characterId}>Choose a linked character</option>}
      {characters.map((player, index) => <option key={player.id} value={player.id}>{player.name}{index === 0 ? ' (Main)' : ' (Alt)'}</option>)}
    </select></label>
    <label>Response<select value={status} onChange={(event) => {
      const value = signupStatuses.find((entry) => entry === event.target.value)
      if (value) setStatus(value)
    }} disabled={busy || closed}>{signupStatuses.map((entry) => <option value={entry} key={entry}>{signupLabels[entry]}</option>)}</select></label>
    <p>Bench means self-benched. Unavailable dates do not submit a response. No seats are allocated automatically.</p>
    {error && <p role="alert">{error}</p>}
    <button className="button button-primary" disabled={busy || closed || !characterValid}>Save response</button>
  </form>
}
