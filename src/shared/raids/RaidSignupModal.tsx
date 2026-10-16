import { useEffect, useRef, useState } from 'react'
import { formatRaidTime, isRaidCancelled, raidTimeOf, type PlayerRecord } from '../../guildApi'
import { saveRaidSignup, signupLabels, signupStatuses, subscribeRaidSignups, type RaidSignup, type SignupStatus } from '../../raidSignups'
import type { TabContext } from '../tabs/types'
import { Modal } from '../ui/Modal'
import { canViewRaidTeam, raidSignupTeam, signupCharacters } from './roster'
import { effectiveRaidSignups, unavailableOn } from './availability'
import './RaidSignup.css'

export function RaidSignupModal({ raidId, close, live, onEdit }: { raidId: string; close: () => void; live: TabContext; onEdit?: () => void }) {
  const [signups, setSignups] = useState<RaidSignup[] | null>(null)
  const [readError, setReadError] = useState('')
  const [now, setNow] = useState(Date.now)
  const [preview, setPreview] = useState(false)
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
  const responses = signups ? effectiveRaidSignups(signups, live.data.afkEntries, live.data.roster, raid.date) : []
  const mine = responses.find((signup) => signup.id === live.identity.uid)
  const unavailable = unavailableOn(live.data.afkEntries, live.identity.uid, raid.date)
  const closed = isRaidCancelled(raid) ? 'This raid is cancelled. Sign-ups are closed.'
    : !raid.startsAt ? 'Sign-ups are not enabled for this older raid. Ask a leader to open Edit raid and save its details once.'
      : raid.startsAt.toMillis() <= now ? 'The raid has started. Sign-up changes are closed.' : ''
  const canPreview = !unavailable && canViewRaidTeam(mine)
  const showingPreview = preview && canPreview
  const team = raidSignupTeam(mine, live.data.roster, live.data.assignments, live.data.settings)
  const responseFor = (player: PlayerRecord) => {
    const response = responses.find((entry) => entry.characterId === player.id)
    if (response) return signupLabels[response.status]
    const other = player.linkedUid ? responses.find((entry) => entry.id === player.linkedUid) : undefined
    return other ? `Responded as ${live.data.roster.find((entry) => entry.id === other.characterId)?.name ?? 'another character'}` : 'No response'
  }

  return <Modal title={showingPreview ? `${raid.name} · Raid team` : raid.name} onClose={close}>
    <div className="raid-signup">
      <p>{raid.date} · {formatRaidTime(raidTimeOf(raid))}</p>
      {!showingPreview && raid.description && <p>{raid.description}</p>}
      {Boolean(raid.zones?.length) && <p>{raid.zones?.map((zone) => `${zone.name} (${zone.size}-player)`).join(' · ')}</p>}
      {!showingPreview && onEdit && live.identity.canEditRaidData && <button className="button button-secondary" disabled={live.feedback.busy} onClick={onEdit}>Edit raid</button>}
      {!showingPreview && closed && <p role="status">{closed}</p>}
      {readError ? <p role="alert">{readError}</p> : signups === null ? <p role="status">Loading sign-ups…</p> : <>
        {!showingPreview ? <>
        {unavailable && <p role="status">You are marked unavailable: <strong>Absent</strong>. Remove all unavailable events covering this raid date to change your response. Your response will remain Absent until you choose another response.</p>}
        {mine && !unavailable && <p role="status">Your saved response: <strong>{signupLabels[mine.status]}</strong> · {live.data.roster.find((player) => player.id === mine.characterId)?.name ?? 'Character no longer on roster'}</p>}
        {characters.length ? <SignupForm key={`${live.identity.uid}:${mine?.characterId ?? ''}:${mine?.status ?? ''}`} raidId={raidId} live={live} characters={characters} mine={mine} closed={Boolean(closed) || unavailable} />
          : <p>A Guild Leader must link your account to a main character before you can sign up.</p>}
        {canPreview && <button type="button" className="button button-secondary" disabled={live.feedback.busy} onClick={() => setPreview(true)}>View raid team</button>}
        </> : <>
        <h3>Raid team preview</h3>
        <p>Current Raid Teams assignments, not confirmed seats or an attendance record. No starting roster is saved yet; this preview continues to reflect team changes after start. Automatic snapshots come later.</p>
        {team ? <section className="raid-signup-group">
          <h4>{team.name} (10-player)</h4>
          <p>{team.players.length} assigned · {responses.filter((entry) => ['accept', 'late'].includes(entry.status) && team.players.some((player) => player.id === entry.characterId)).length} Accept/Late responses</p>
          <ul>{team.players.map((player) => <li key={player.id}><span>{player.name} · {player.role}</span><strong>{responseFor(player)}</strong></li>)}</ul>
        </section> : <p role="status">No team assigned. Ask a Guild Leader to assign your signed-up character to a 10-player team.</p>}
        </>}
      </>}
      <div className="modal-actions">{showingPreview && <button type="button" className="button button-secondary" onClick={() => setPreview(false)}>Back to sign-up</button>}<button className="button button-secondary" onClick={close}>Close</button></div>
    </div>
  </Modal>
}

function SignupForm({ raidId, live, characters, mine, closed }: { raidId: string; live: TabContext; characters: PlayerRecord[]; mine?: RaidSignup; closed: boolean }) {
  const [characterId, setCharacterId] = useState(mine?.characterId ?? characters[0].id)
  const [error, setError] = useState('')
  const saving = useRef(false)
  const { busy, setBusy, setNotice, setMutationError } = live.feedback
  const characterValid = characters.some((player) => player.id === characterId)

  async function save(status: SignupStatus) {
    if (busy || closed || saving.current) return
    if (!characterValid) { setError('Choose one of your currently linked characters.'); return }
    saving.current = true
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
      saving.current = false
      setBusy(false)
    }
  }

  return <div className="raid-signup-form">
    <label>Character<select value={characterId} onChange={(event) => setCharacterId(event.target.value)} disabled={busy || closed}>
      {!characterValid && <option value={characterId}>Choose a linked character</option>}
      {characters.map((player, index) => <option key={player.id} value={player.id}>{player.name}{index === 0 ? ' (Main)' : ' (Alt)'}</option>)}
    </select></label>
    <div className="raid-signup-responses" role="group" aria-label="Save your raid response">
      {signupStatuses.map((status) => <button type="button" key={status}
        className="button button-secondary"
        data-response={status}
        aria-pressed={mine?.characterId === characterId && mine.status === status}
        disabled={busy || closed || !characterValid}
        onClick={() => void save(status)}>{signupLabels[status]}</button>)}
    </div>
    {error && <p role="alert">{error}</p>}
  </div>
}
