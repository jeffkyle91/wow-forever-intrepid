import { useState, type ReactNode } from 'react'
import type { RaidRecord, RaidSize } from '../../guildApi'
import { signupLabels, type RaidSignup } from '../../raidSignups'
import { initializeScheduledRoster } from '../../scheduledRaids'
import { classAccent } from '../game/classes'
import type { TabContext } from '../tabs/types'
import { ClassAvatar } from '../ui/ClassAvatar'
import { scheduledCharacterResponse, scheduledRosterGroups, type ScheduledRoster } from './planning'
import { ScheduledResponseSummary } from './ScheduledResponseSummary'
import { useScheduledRoster } from './useScheduledRoster'
import './ScheduledRaidRoster.css'

export function ScheduledRaidRoster({ raid, live, responses, closed, management = false, renderWorkbench }: { raid: RaidRecord; live: TabContext; responses: RaidSignup[]; closed: boolean; management?: boolean; renderWorkbench?: (roster: ScheduledRoster) => ReactNode }) {
  const state = useScheduledRoster(raid.id)
  const [error, setError] = useState('')
  const showReview = management && live.identity.canEditRaidData
  const canEdit = showReview && !closed
  async function initialize() {
    if (live.feedback.busy) return
    live.feedback.setBusy(true)
    setError('')
    try {
      await initializeScheduledRoster(raid.id)
      live.feedback.setMutationError('')
      live.feedback.setNotice('Scheduled roster initialized from current standing teams.')
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Could not initialize the scheduled roster.'
      setError(message)
      live.feedback.setMutationError(message)
    } finally { live.feedback.setBusy(false) }
  }
  if (state.error) return <section role="alert"><p>Could not load the scheduled roster: {state.error}</p><button className="button button-secondary" onClick={state.retry}>Retry roster</button></section>
  if (!state.loaded) return <p role="status">Loading scheduled roster...</p>
  if (!state.roster) return <section className="scheduled-roster">
    <p>This older raid has no scheduled working roster. A leader can copy current standing teams once; past assignments cannot be reconstructed.</p>
    {canEdit && <button className="button button-secondary" disabled={live.feedback.busy} onClick={() => void initialize()}>Initialize scheduled roster</button>}
    {closed && <p>Initialization is closed for cancelled or started raids.</p>}
    {error && <p role="alert">{error}</p>}
  </section>
  if (live.data.dataError || live.data.readinessError) return <p role="alert">Roster details are unavailable: {live.data.dataError || live.data.readinessError}. Reload to retry.</p>
  if (!live.data.raidPlanningLoaded || !live.data.readinessLoaded) return <p role="status">Loading character and readiness details...</p>
  if (live.data.unreadable) return <p role="alert">Some guild records could not be read. Correct them before planning this raid.</p>
  if (renderWorkbench) return renderWorkbench(state.roster)
  return <WorkingRoster key={raid.id} raid={raid} live={live} responses={responses} roster={state.roster} />
}

function WorkingRoster({ raid, live, responses, roster }: { raid: RaidRecord; live: TabContext; responses: RaidSignup[]; roster: ScheduledRoster }) {
  const sizes = [...new Set(raid.zones?.length ? raid.zones.map((zone) => zone.size) : [raid.size])]
  const [selectedSize, setSelectedSize] = useState<RaidSize>(sizes[0])
  const size = sizes.includes(selectedSize) ? selectedSize : sizes[0]
  const lineup = roster.lineups.find((entry) => entry.size === size)
  const { roster: characters } = live.data
  if (!lineup) return <p role="alert">No readable lineup exists for this raid size.</p>
  const groups = scheduledRosterGroups(lineup, roster.invitations, characters, responses)
  const describe = (characterId: string) => {
    const response = scheduledCharacterResponse(characterId, roster.invitations, characters, responses)
    return response ? `${signupLabels[response.status]}${response.characterId !== characterId ? ' on another character' : ''}` : 'Not responded'
  }
  const row = (characterId: string) => {
    const character = characters.find((entry) => entry.id === characterId)
    return <li key={characterId} className={`scheduled-character${character ? ` ${classAccent(character.className)}` : ''}`}>
      <div className="scheduled-character-identity">
        {character && <ClassAvatar player={character} />}
        <span className="roster-pool-member-info"><strong>{character?.name ?? 'Character no longer on roster'}</strong>{character && <small>{character.specialization || character.className}</small>}</span>
      </div>
      <div className="scheduled-character-actions">
        <span className="button button-secondary scheduled-response" aria-label={`Response: ${describe(characterId)}`}>{describe(characterId)}</span>
      </div>
    </li>
  }
  return <section className="scheduled-roster" aria-label="Scheduled raid working roster">
    <h3>Scheduled raid roster</h3>
    <p>Independent lineups for this raid only. Standing Raid Teams will not change. Responses and positions are separate; neither proves attendance.</p>
    <p className="scheduled-warning">Automatic immutable start capture is not implemented yet. After start this working roster is read-only, not a saved starting snapshot.</p>
    <div className="segmented-control" role="group" aria-label="Scheduled lineup size">{sizes.map((option) => <button type="button" key={option} className={`segment${option === size ? ' selected' : ''}`} aria-pressed={option === size} onClick={() => setSelectedSize(option)}>{option}-player</button>)}</div>
    <p>Read-only lineup. Guild and Raid Leaders manage positions in Scheduled Raids before raid start.</p>
    <div className="scheduled-team-grid">{groups.map((group) => <section className="scheduled-team" key={group.key}>
      <h4>{group.name} · {group.characterIds.length}{group.key !== 'bench' && group.key !== 'unassigned' ? `/${size}` : ''}</h4>
      {group.key === 'bench' ? <p>Bench for this {size}-player lineup only. A voluntary Bench response does not assign a position. Bench-ready confirmation and attendance credit come later.</p>
        : group.key === 'unassigned' ? <p>All remaining invitees, including unready and absent raiders. Selected characters appear after a response; otherwise their main is shown. Not automatically benched.</p>
          : <ScheduledResponseSummary characterIds={group.characterIds} invitations={roster.invitations} characters={characters} responses={responses} />}
      {group.characterIds.length ? <ul>{group.characterIds.map(row)}</ul> : <p>{group.key === 'unassigned' ? 'All invitees have a scheduled position for this size.' : 'No raiders placed.'}</p>}
    </section>)}</div>
  </section>
}
