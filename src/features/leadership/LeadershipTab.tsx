import { useEffect, useState } from 'react'
import { CalendarDays, ShieldCheck } from 'lucide-react'
import { formatRaidTime, raidTimeOf, type RaidRecord } from '../../guildApi'
import { subscribeRaidSignups, signupLabels, type RaidSignup } from '../../raidSignups'
import { CharacterRequestsPanel } from '../../shared/characters/CharacterRequestsPanel'
import { namedTeams, standingAssignments } from '../../shared/game/teams'
import { RaidCoveragePanel } from '../../shared/raid-coverage/RaidCoveragePanel'
import { RaidCoverageStrip } from '../../shared/raid-coverage/RaidCoverageStrip'
import { coverageTargets } from '../../shared/raid-coverage/teamSelection'
import type { TabContext } from '../../shared/tabs/types'
import { ClassAvatar } from '../../shared/ui/ClassAvatar'
import { classAccent } from '../../shared/game/classes'
import { responseOverview, upcomingLeadershipRaids } from './overview'
import { useScheduledRoster } from '../../shared/raids/useScheduledRoster'
import './Leadership.css'

function RaidResponses({ raid, ctx }: { raid: RaidRecord; ctx: TabContext }) {
  const planned = useScheduledRoster(raid.id)
  const [responses, setResponses] = useState<RaidSignup[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    return subscribeRaidSignups(raid.id, (records) => { setResponses(records); setLoaded(true) }, (failure) => setError(failure.message))
  }, [raid.id, retry])
  const overview = responseOverview(ctx.data.members, ctx.data.roster, ctx.data.readiness, responses, planned.roster?.invitations.map((entry) => entry.uid))
  if (planned.error) return <p role="alert">Could not load invited raiders: {planned.error} <button className="button button-secondary" onClick={planned.retry}>Retry roster</button></p>
  if (!planned.loaded) return <p role="status">Loading invited raiders...</p>
  if (!planned.roster) return <p>This raid has no scheduled invitation list yet. Open its scheduled roster on the calendar to initialize it; missing-response counts are unavailable.</p>
  if (error) return <p role="alert">Could not load raid responses: {error} <button className="button button-secondary" onClick={() => { setError(''); setLoaded(false); setRetry((value) => value + 1) }}>Retry</button></p>
  if (!loaded) return <p role="status">Loading raid responses...</p>
  return <>
    <div className="leadership-counts" aria-label="Response summary">
      <span><strong>{overview.missing.length}</strong> Missing responses</span>
      <span><strong>{overview.eligible.length}</strong> Active linked invitees</span>
      <span><strong>{overview.warnings.length}</strong> Response character warnings</span>
    </div>
    <p>Invite members with a ready main, regardless of team assignment. New invitees are added until start; existing invitations remain if readiness is removed. Ready alts alone do not qualify an invitation. A response is not proof of attendance.</p>
    <ul className="leadership-accounts">{overview.missing.map(({ member, main, ready }) => <li key={member.id}>
      {main && <span className={classAccent(main.className)}><ClassAvatar player={main} /><strong>{main.name}</strong></span>}
      <small>{ready.length ? `Ready characters: ${ready.map((character) => character.name).join(', ')}` : 'No ready characters'}</small>
      {!ready.some((character) => character.id === main?.id) && <small><strong>Main not ready:</strong> invitation retained for review.</small>}
    </li>)}</ul>
    {!overview.missing.length && <p>{overview.eligible.length ? 'All active linked invitees have a saved response.' : 'No active linked invitees yet. Mark mains raid ready to include their accounts.'}</p>}
    <details><summary>Setup: {overview.notInvited.length} linked accounts not invited; {overview.unlinked.length} unlinked accounts</summary>
      <p>Excluded from missing-response checks. {overview.removed} removed/inactive accounts are also excluded.</p>
      <ul>{overview.notInvited.map(({ member, main }) => <li key={member.id}>{main?.name}: not yet invited; a ready main is required</li>)}{overview.unlinked.map(({ member }) => <li key={member.id}>{member.displayName || 'Guild member'}: missing or inconsistent character link</li>)}</ul>
      <button className="button button-secondary" onClick={() => ctx.navigate('roster')}>Manage character readiness</button>{' '}
      <button className="button button-secondary" onClick={() => ctx.navigate('access')}>Member access</button>
    </details>
    {overview.warnings.length > 0 && <section className="leadership-warning"><h4>Responses needing readiness review</h4><p>Responses remain valid. These accounts chose an unready or no-longer-owned character for Accept, Tentative or Late.</p>
      <ul>{overview.warnings.map(({ member, main, selected, response }) => <li key={member.id}>{main?.name || member.displayName || 'Guild member'}: {response && signupLabels[response.status]} on {selected?.name || 'an unavailable character'}</li>)}</ul>
    </section>}
  </>
}

function LeadershipOverview({ ctx }: { ctx: TabContext }) {
  const [selectedId, setSelectedId] = useState('')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const raids = upcomingLeadershipRaids(ctx.data.raids, now)
  const raid = raids.find((record) => record.id === selectedId) ?? raids[0]
  const teams = namedTeams(ctx.data.settings.teamNames)
  const sizes = raid ? [...new Set(raid.zones?.length ? raid.zones.map((zone) => zone.size) : [raid.size])] : []
  const coverageSize = sizes.includes(ctx.shell.raidView) ? ctx.shell.raidView : sizes[0]
  if (ctx.data.dataError || ctx.data.readinessError) return <p role="alert">Leadership data could not be loaded: {ctx.data.dataError || ctx.data.readinessError} Reload to retry; counts are unavailable.</p>
  if (!ctx.data.leadershipLoaded || !ctx.data.readinessLoaded) return <p role="status">Loading leadership data...</p>
  if (ctx.data.unreadable) return <p role="alert">Some guild records are unreadable. Leadership counts are unavailable until those records are corrected.</p>
  return <div className="leadership-grid">
    <div className="leadership-counts leadership-summary"><span><strong>{raids.length}</strong> Upcoming raids</span><span><strong>{ctx.data.characterRequestsError ? 'Unavailable' : ctx.data.characterRequestsLoaded ? ctx.data.characterRequests.filter((request) => request.status === 'pending').length : 'Loading'}</strong> Pending character requests</span></div>
    <section className="leadership-card"><h3><CalendarDays size={15} aria-hidden="true" />Missing raid responses</h3>
      {raid ? <>
        <label>Upcoming raid <select value={raid.id} onChange={(event) => setSelectedId(event.target.value)}>{raids.map((record) => <option key={record.id} value={record.id}>{record.date} - {record.name} ({formatRaidTime(raidTimeOf(record))})</option>)}</select></label>
        <button className="button button-secondary" onClick={() => ctx.navigate('afk', raid.id)}>Open raid calendar</button>
        <RaidResponses key={raid.id} raid={raid} ctx={ctx} />
      </> : <p>No upcoming non-cancelled raids. <button className="button button-secondary" onClick={() => ctx.navigate('afk')}>Open raid calendar</button></p>}
    </section>
    <CharacterRequestsPanel ctx={ctx} review />
    <section className="leadership-card leadership-coverage"><h3><ShieldCheck size={15} aria-hidden="true" />Coverage gaps</h3>
      <div className="segmented-control leadership-size-selector" role="group" aria-label="Coverage raid team size">{([10, 20, 40] as const).map((size) => <button key={size} className={coverageSize === size ? 'segment selected' : 'segment'} disabled={!sizes.includes(size)} aria-pressed={coverageSize === size} onClick={() => ctx.shell.setRaidView(size)}>{size}<span>player</span></button>)}</div>
      <p>Current assigned teams only, not sign-up-adjusted coverage, attendance or a starting snapshot. Game data is provisional; unknown effects are not confirmed coverage.</p>
      {!raid && <p>Select an upcoming raid to see its team sizes.</p>}
      {coverageSize !== undefined && [coverageSize].map((size) => <section key={size} aria-label={`${size}-player team coverage`}>
        {coverageTargets(size, teams, ctx.data.settings.groupNames).map((target) => <div key={target.key}><h4>{target.name}</h4><RaidCoverageStrip parts={target.parts} players={ctx.data.roster} assignments={standingAssignments(ctx.data, size)} /></div>)}
        <RaidCoveragePanel view={size} teams={teams} groupNames={ctx.data.settings.groupNames} players={ctx.data.roster} assignments={standingAssignments(ctx.data, size)} />
        <button className="button button-secondary" onClick={() => { ctx.shell.setRaidView(size); ctx.navigate('teams') }}>Open {size}-player coverage details</button>
      </section>)}
    </section>
  </div>
}

export function LeadershipTab({ ctx }: { ctx: TabContext }) {
  return ctx.identity.canEditRoster ? <LeadershipOverview ctx={ctx} /> : <p>Leadership Overview is available to Guild Leaders only.</p>
}
