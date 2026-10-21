import { useEffect, useState } from 'react'
import { isRaidCancelled, raidTimeOf, type RaidRecord } from '../../guildApi'
import { subscribeRaidSignups, type RaidSignup } from '../../raidSignups'
import { effectiveRaidSignups } from '../../shared/raids/availability'
import { RaidSignupModal } from '../../shared/raids/RaidSignupModal'
import { ScheduledRaidRoster } from '../../shared/raids/ScheduledRaidRoster'
import type { TabContext } from '../../shared/tabs/types'
import './ScheduledRaids.css'
import { ScheduledRaidWorkbench } from './ScheduledRaidWorkbench'

export function ScheduledRaidsTab({ ctx }: { ctx: TabContext }) {
  const [selection, setSelection] = useState({ id: '', navParam: ctx.navParam })
  const [now, setNow] = useState(Date.now)
  const [hideAlts, setHideAlts] = useState(false)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const raids = [...ctx.data.raids].sort((a, b) => a.date.localeCompare(b.date) || raidTimeOf(a).localeCompare(raidTimeOf(b)) || a.id.localeCompare(b.id))
  const selectedId = selection.navParam === ctx.navParam ? selection.id || ctx.navParam : ctx.navParam
  const raid = raids.find((entry) => entry.id === selectedId)
    ?? raids.find((entry) => !isRaidCancelled(entry) && entry.startsAt && entry.startsAt.toMillis() > now)
    ?? raids[0]
  if (ctx.data.dataError) return <p role="alert">Scheduled raids could not be loaded: {ctx.data.dataError}. Reload to retry.</p>
  if (!ctx.data.raidPlanningLoaded) return <p role="status">Loading scheduled raids...</p>
  if (ctx.data.unreadable) return <p role="alert">Some guild records are unreadable. Correct them before viewing scheduled raids.</p>
  if (!raid) return <p>No scheduled raids yet. <button className="button button-secondary" onClick={() => ctx.navigate('afk')}>Open Guild Calendar</button></p>
  const closed = isRaidCancelled(raid) || !raid.startsAt || raid.startsAt.toMillis() <= now
  const sizes = [...new Set(raid.zones?.length ? raid.zones.map((zone) => zone.size) : [raid.size])]
  const size = sizes.includes(ctx.shell.raidView) ? ctx.shell.raidView : sizes[0]
  return <div className="scheduled-raids-tool">
    <label>Scheduled raid<select value={raid.id} onChange={(event) => setSelection({ id: event.target.value, navParam: ctx.navParam })}>{raids.map((entry) => <option key={entry.id} value={entry.id}>{entry.date} · {entry.name}{isRaidCancelled(entry) ? ' (cancelled)' : ''}</option>)}</select></label>
    <div className="scheduled-raids-actions">
      <button className="button button-secondary" onClick={() => ctx.openModal(({ close, live }) => <RaidSignupModal raidId={raid.id} close={close} live={live} />)}>Your sign-up / roster</button>
      <button className="button button-secondary" onClick={() => ctx.navigate('afk', raid.id)}>Open Guild Calendar</button>
      <div className="scheduled-workbench-toolbar">
        <div className="segmented-control" role="group" aria-label="Scheduled lineup size">{([10, 20, 40] as const).map((option) => <button type="button" key={option} disabled={!sizes.includes(option)} className={option === size ? 'segment selected' : 'segment'} aria-pressed={option === size} onClick={() => ctx.shell.setRaidView(option)}>{option}<span>player</span></button>)}</div>
        <div className="segmented-control" role="group" aria-label="Available characters">
          <button type="button" className={hideAlts ? 'segment' : 'segment selected'} aria-pressed={!hideAlts} onClick={() => setHideAlts(false)}>All characters</button>
          <button type="button" className={hideAlts ? 'segment selected' : 'segment'} aria-pressed={hideAlts} onClick={() => setHideAlts(true)}>Hide alts</button>
        </div>
      </div>
    </div>
    <RaidRoster key={raid.id} raid={raid} ctx={ctx} closed={closed} hideAlts={hideAlts} />
  </div>
}

function RaidRoster({ raid, ctx, closed, hideAlts }: { raid: RaidRecord; ctx: TabContext; closed: boolean; hideAlts: boolean }) {
  const [responses, setResponses] = useState<RaidSignup[] | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => subscribeRaidSignups(raid.id, (records) => { setResponses(records); setError('') },
    (failure) => { setResponses(null); setError(failure.message) }), [raid.id, retry])
  if (error) return <p role="alert">Could not load raid responses: {error} <button className="button button-secondary" onClick={() => { setError(''); setRetry((value) => value + 1) }}>Retry responses</button></p>
  if (!responses) return <p role="status">Loading raid responses...</p>
  const effective = effectiveRaidSignups(responses, ctx.data.afkEntries, ctx.data.roster, raid.date)
  return <ScheduledRaidRoster raid={raid} live={ctx} responses={effective} closed={closed} management renderWorkbench={(roster) => <ScheduledRaidWorkbench key={ctx.shell.raidView} raid={raid} ctx={ctx} responses={effective} roster={roster} closed={closed} hideAlts={hideAlts} />} />
}
