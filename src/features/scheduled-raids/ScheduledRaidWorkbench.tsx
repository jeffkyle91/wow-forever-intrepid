import { useRef, useState, type DragEvent } from 'react'
import { Plus } from 'lucide-react'
import type { PlayerRecord, RaidRecord, StandingTeam } from '../../guildApi'
import { signupLabels, type RaidSignup } from '../../raidSignups'
import { changeScheduledPlacement } from '../../scheduledRaids'
import { namedTeams } from '../../shared/game/teams'
import { altIds } from '../../shared/game/alts'
import { RaidCoveragePanel } from '../../shared/raid-coverage/RaidCoveragePanel'
import { RaidCoverageStrip } from '../../shared/raid-coverage/RaidCoverageStrip'
import { characterAccount, lineupWarnings, placementWarnings, scheduledAvailableCharacters, scheduledCandidates, scheduledCharacterResponse, type ScheduledRoster } from '../../shared/raids/planning'
import { ScheduledResponseSummary } from '../../shared/raids/ScheduledResponseSummary'
import type { TabContext } from '../../shared/tabs/types'
import { GuildRosterPool } from '../../shared/teams/GuildRosterPool'
import { StandingTeamCard } from '../../shared/teams/StandingTeamCard'
import { Modal } from '../../shared/ui/Modal'
import { HelpPopover } from '../../shared/ui/HelpPopover'
import '../../shared/teams/Teams.css'

export function ScheduledRaidWorkbench({ raid, ctx, responses, roster, closed, hideAlts }: { raid: RaidRecord; ctx: TabContext; responses: RaidSignup[]; roster: ScheduledRoster; closed: boolean; hideAlts: boolean }) {
  const sizes = [...new Set(raid.zones?.length ? raid.zones.map((zone) => zone.size) : [raid.size])]
  const size = sizes.includes(ctx.shell.raidView) ? ctx.shell.raidView : sizes[0]
  const lineup = roster.lineups.find((entry) => entry.size === size)
  const [dropTarget, setDropTarget] = useState('')
  const [benchSelection, setBenchSelection] = useState('')
  const [error, setError] = useState('')
  const saving = useRef(false)
  const { roster: characters, readiness, afkEntries } = ctx.data
  const showReview = ctx.identity.canEditRaidData
  const canEdit = showReview && !closed
  const busy = ctx.feedback.busy
  if (!lineup) return <p role="alert">No readable lineup exists for this raid size.</p>
  const teams = lineup.teams.map(({ key, name }) => ({ key, name }))
  const assignments: Record<string, StandingTeam> = {}
  for (const team of lineup.teams) for (const characterId of team.characterIds) assignments[characterId] = team.key
  const placedIds = [...Object.keys(assignments), ...lineup.bench]
  const unassigned = scheduledAvailableCharacters(lineup, roster.invitations, characters, responses)
  const alts = altIds(characters)
  const available = hideAlts ? unassigned.filter((character) => !alts.has(character.id)) : unassigned
  const candidates = scheduledCandidates(characters, readiness, responses)
  const addable = available.filter((character) => candidates.some((candidate) => candidate.id === character.id))
  const bench = characters.filter((character) => lineup.bench.includes(character.id))
  const knownIds = new Set([...placedIds, ...unassigned.map((character) => character.id)])
  const unresolved = placedIds.filter((characterId) => !characters.some((character) => character.id === characterId))
  const missingInvitees = roster.invitations.filter((invitation) => !characters.some((character) => character.id === invitation.mainId || characterAccount(character.id, characters)?.uid === invitation.uid))
  const warnings = lineupWarnings(lineup, characters)
  const names = new Map(roster.lineups.flatMap((entry) => entry.teams.map((team) => [team.key, team.name] as const)))
  const teamNames = { blue: names.get('blue')!, yellow: names.get('yellow')!, red: names.get('red')!, white: names.get('white')! }
  const groupNames = { green: names.get('green')!, pink: names.get('pink')!, brown: names.get('brown')! }
  const responseText = (characterId: string) => {
    const response = scheduledCharacterResponse(characterId, roster.invitations, characters, responses)
    return response ? `${signupLabels[response.status]}${response.characterId !== characterId ? ' on another character' : ''}` : 'Not responded'
  }
  const status = (character: PlayerRecord) => <span className="button button-secondary scheduled-workbench-response">{responseText(character.id)}</span>
  const notes = (character: PlayerRecord) => {
    if (!showReview) return null
    const details = placementWarnings(character.id, characters, readiness, responses, afkEntries, raid.date)
    const account = characterAccount(character.id, characters)
    if (placedIds.includes(character.id) && !roster.invitations.some((invitation) => invitation.uid === account?.uid || invitation.mainId === character.id)) details.push("Not on this raid's invitation list; copied position retained for review")
    if (!details.length) return null
    return <HelpPopover label={`Planning warnings for ${character.name}`} triggerClassName="scheduled-warning-button" trigger={<span aria-hidden="true">!</span>}>
      <strong>{character.name} · Planning warnings</strong>
      <ul>{details.map((note) => <li key={note}>{note}</li>)}</ul>
    </HelpPopover>
  }
  async function persist(characterId: string, destination: string, revision: number, acknowledgeAbsence: boolean) {
    if (saving.current) return 'A scheduled position is already being saved.'
    saving.current = true
    ctx.feedback.setBusy(true)
    setError('')
    try {
      await changeScheduledPlacement(raid.id, size, characterId, destination, revision, acknowledgeAbsence)
      ctx.feedback.setMutationError('')
      ctx.feedback.setNotice('Scheduled position updated. Standing teams and the member response are unchanged.')
      return ''
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Could not update the scheduled position.'
      setError(message)
      ctx.feedback.setMutationError(message)
      return message
    } finally {
      saving.current = false
      ctx.feedback.setBusy(false)
    }
  }
  function move(characterId: string, destination: string) {
    if (!canEdit || busy || saving.current) return
    if (!knownIds.has(characterId)) {
      const message = 'That character is not on this scheduled raid. Review the selected raid and try again.'
      setError(message)
      ctx.feedback.setMutationError(message)
      return
    }
    const absent = placementWarnings(characterId, characters, readiness, responses, afkEntries, raid.date).includes('Absent or unavailable')
    if (absent && destination !== 'unassigned') {
      ctx.openModal(({ close, live }) => <ConfirmAbsentPlacement characterName={characters.find((character) => character.id === characterId)?.name ?? 'This raider'} destinationName={teams.find((team) => team.key === destination)?.name ?? 'Assigned bench'} close={close} live={live} save={() => persist(characterId, destination, roster.revision, true)} />)
    } else void persist(characterId, destination, roster.revision, false)
  }
  const dragStart = (event: DragEvent<HTMLDivElement>, characterId: string) => {
    event.dataTransfer.setData('text/plain', characterId)
    event.dataTransfer.setData('application/x-intrepid-scheduled-raid', `${raid.id}:${size}`)
    event.dataTransfer.effectAllowed = 'move'
  }
  const dragOver = (event: DragEvent<HTMLElement>, destination: string) => {
    if (canEdit && !busy) { event.preventDefault(); setDropTarget(destination) }
  }
  const drop = (event: DragEvent<HTMLElement>, destination: string) => {
    event.preventDefault()
    setDropTarget('')
    if (!canEdit || busy) return
    if (event.dataTransfer.getData('application/x-intrepid-scheduled-raid') !== `${raid.id}:${size}`) {
      const message = 'Drag a character from this scheduled raid, not another raid or the standing teams.'
      setError(message)
      ctx.feedback.setMutationError(message)
      return
    }
    move(event.dataTransfer.getData('text/plain'), destination)
  }
  return <div className="scheduled-workbench raid-team-view">
    {closed && <p role="status">Planning is closed. This raid is read-only.</p>}
    {showReview && warnings.length > 0 && <div role="alert">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
    {error && <p role="alert">{error}</p>}
    <div className="raid-team-workbench">
      <div className="scheduled-roster-pools">
        <GuildRosterPool players={available} hiddenAlts={unassigned.length - available.length} totalPlayers={roster.invitations.length} canEdit={canEdit && !busy} title="Available roster" description={`${available.length} unassigned characters${unassigned.length !== available.length ? ` (${unassigned.length - available.length} alts hidden)` : ''} · ${roster.invitations.length} invited raiders`} hint="Drop here to remove a scheduled position. Only this raid changes. Unready invitees remain visible but cannot be newly placed." dragHint="to a scheduled team or bench" memberNote={notes} memberStatus={status} dropActive={dropTarget === 'unassigned'} onDragStart={dragStart} onDragOver={(event) => dragOver(event, 'unassigned')} onDragLeave={() => setDropTarget('')} onDrop={(event) => drop(event, 'unassigned')} />
        <GuildRosterPool players={bench} hiddenAlts={0} totalPlayers={bench.length} canEdit={canEdit && !busy} title="Assigned bench" description={`${lineup.bench.length} assigned for this ${size}-player lineup`} hint="Drop here to assign bench for this raid. A voluntary Bench response is separate; readiness confirmation and attendance credit come later." dragHint="to a scheduled team or the available roster" memberNote={(character) => <>{notes(character)}{canEdit && <select className="move-team-select" aria-label={`Move ${character.name} from bench`} value="bench" disabled={busy} onChange={(event) => move(character.id, event.target.value)}><option value="bench">Bench</option><option value="unassigned">Unassigned</option>{teams.map((team) => <option key={team.key} value={team.key}>{team.name}</option>)}</select>}</>} memberStatus={status} dropActive={dropTarget === 'bench'} onDragStart={dragStart} onDragOver={(event) => dragOver(event, 'bench')} onDragLeave={() => setDropTarget('')} onDrop={(event) => drop(event, 'bench')} />
        {canEdit && <form className="team-add-form" onSubmit={(event) => { event.preventDefault(); if (benchSelection) move(benchSelection, 'bench'); setBenchSelection('') }}>
          <select aria-label="Choose a raider to add to bench" value={benchSelection} disabled={busy || !addable.length} onChange={(event) => setBenchSelection(event.target.value)}><option value="">Add to bench</option>{addable.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select>
          <button className="add-team-member" type="submit" aria-label="Add raider to bench" disabled={busy || !benchSelection}><Plus size={16} /></button>
        </form>}
      </div>
      <div className="raid-team-views"><div className={`team-grid ${size === 10 ? 'team-grid-four' : size === 20 ? 'team-grid-two' : 'team-grid-one'}`}>{lineup.teams.map((team) => <StandingTeamCard key={team.key} team={team} teams={teams} members={characters.filter((character) => assignments[character.id] === team.key)} occupiedCount={team.characterIds.length} roster={characters} assignments={assignments} available={addable} canEdit={canEdit} busy={busy} showConflicts={showReview} subtitle={`Scheduled ${size}-player team`} memberNote={notes} memberStatus={status} responseSummary={<ScheduledResponseSummary characterIds={team.characterIds} invitations={roster.invitations} characters={characters} responses={responses} />} coverage={<RaidCoverageStrip parts={[team.key]} players={characters} assignments={assignments} />} extraDestinations={[{ key: 'bench', name: 'Assigned bench' }]} onExtraMove={move} dropActive={dropTarget === team.key} onDragStart={dragStart} onDragOver={(event) => dragOver(event, team.key)} onDragLeave={() => setDropTarget('')} onDrop={(event) => drop(event, team.key)} onAssign={move} onMove={move} onRemove={(characterId) => move(characterId, 'unassigned')} />)}</div></div>
    </div>
    {unresolved.length > 0 && <section><h4>Characters no longer on the roster</h4>{unresolved.map((characterId) => <p key={characterId}>Missing character · {assignments[characterId] ? teams.find((team) => team.key === assignments[characterId])?.name : 'Assigned bench'} {canEdit && <button className="button button-secondary" disabled={busy} onClick={() => move(characterId, 'unassigned')}>Remove missing position</button>}</p>)}</section>}
    {showReview && missingInvitees.length > 0 && <p>{missingInvitees.length} invited raiders no longer have a roster character. Review their member links before assigning positions.</p>}
    <RaidCoveragePanel key={size} view={size} teams={namedTeams(teamNames)} groupNames={groupNames} players={characters} assignments={assignments} />
    <p>Positions and responses are separate. Standing teams are unchanged. Automatic immutable start capture is not implemented yet.</p>
  </div>
}

function ConfirmAbsentPlacement({ characterName, destinationName, close, live, save }: { characterName: string; destinationName: string; close: () => void; live: TabContext; save: () => Promise<string> }) {
  const [error, setError] = useState('')
  async function confirm() {
    const message = await save()
    if (message) setError(message)
    else close()
  }
  return <Modal title="Place absent or unavailable raider?" onClose={close}><div className="modal-form">
    <p>{characterName} is Absent or unavailable. Place them in {destinationName} without changing their response or unavailable dates?</p>
    {error && <p role="alert">{error}</p>}
    <div className="modal-actions"><button className="button button-secondary" disabled={live.feedback.busy} onClick={close}>Cancel</button><button className="button button-secondary" disabled={live.feedback.busy || !live.identity.canEditRaidData} onClick={() => void confirm()}>Place without changing response</button></div>
  </div></Modal>
}
