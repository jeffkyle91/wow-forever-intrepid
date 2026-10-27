import { useEffect, useState } from 'react'
import { formatRaidTime, isRaidCancelled, raidTimeOf, type RaidRecord } from '../../guildApi'
import { subscribeRaidSignups, type RaidSignup } from '../../raidSignups'
import { effectiveRaidSignups } from '../../shared/raids/availability'
import { RaidBanner } from '../../shared/raids/RaidBanner'
import { RaidSignupModal } from '../../shared/raids/RaidSignupModal'
import { ScheduledRaidRoster } from '../../shared/raids/ScheduledRaidRoster'
import type { TabContext } from '../../shared/tabs/types'
import { raidRowId } from './groupRaids'
import { ScheduledRaidWorkbench } from './ScheduledRaidWorkbench'

const dateLabel = (date: string) => {
  const day = new Date(`${date}T12:00:00Z`)
  return Number.isNaN(day.getTime()) ? date : day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// What a closed raid says it is. A raid still to come shows no chip.
function statusChip(raid: RaidRecord, closed: boolean) {
  if (isRaidCancelled(raid)) return { label: 'Cancelled', tone: 'cancelled' }
  if (!raid.startsAt) return { label: 'Read-only', tone: 'closed' }
  return closed ? { label: 'Started', tone: 'closed' } : null
}

/**
 * One scheduled raid as a collapsed row: its zone pictures, name, date, time (ET), zones with their sizes and a status chip, all from the raid's own record, so a closed row
 * starts no listener. Opening it mounts the panel that has always been here (the actions and the roster) for this raid only, so its sign-up and planning listeners run only
 * while it is open. A closed <details> still mounts its children, so the panel is rendered only when the row is open.
 */
export function RaidRow({ raid, ctx, closed, open, onToggle }: { raid: RaidRecord; ctx: TabContext; closed: boolean; open: boolean; onToggle: (raidId: string, open: boolean) => void }) {
  const [hideAlts, setHideAlts] = useState(false)
  const zones = raid.zones ?? []
  const sizes = [...new Set(zones.length ? zones.map((zone) => zone.size) : [raid.size])]
  const size = sizes.includes(ctx.shell.raidView) ? ctx.shell.raidView : sizes[0]
  const chip = statusChip(raid, closed)
  return <details className="raid-row" id={raidRowId(raid.id)} open={open} onToggle={(event) => { if (event.target === event.currentTarget) onToggle(raid.id, event.currentTarget.open) }}>
    <summary className="raid-row-summary">
      <span className="raid-row-art"><RaidBanner zones={zones} zoneArt={ctx.data.zoneArt} zoneColors={ctx.data.zoneColors} /></span>
      <h3 className="raid-row-name"><span className="raid-row-caret" aria-hidden="true" />{raid.name}</h3>
      <span className="raid-row-meta">{dateLabel(raid.date)} · {formatRaidTime(raidTimeOf(raid))} · {zones.length ? zones.map((zone) => `${zone.name} (${zone.size})`).join(', ') : `${raid.size}-player`}</span>
      {chip && <span className={`raid-row-chip raid-row-chip-${chip.tone}`}>{chip.label}</span>}
    </summary>
    {open && <div className="raid-row-body">
      <div className="scheduled-raids-actions">
        <button className="button button-secondary" onClick={() => ctx.openModal(({ close, live }) => <RaidSignupModal raidId={raid.id} close={close} live={live} />)}>Your sign-up / roster</button>
        <button className="button button-secondary" onClick={() => ctx.navigate('afk', raid.id)}>Open Guild Calendar</button>
        <div className="scheduled-workbench-toolbar">
          <div className="segmented-control" role="group" aria-label={`Scheduled lineup size for ${raid.name}`}>{([10, 20, 40] as const).map((option) => <button type="button" key={option} disabled={!sizes.includes(option)} className={option === size ? 'segment selected' : 'segment'} aria-pressed={option === size} onClick={() => ctx.shell.setRaidView(option)}>{option}<span>player</span></button>)}</div>
          <div className="segmented-control" role="group" aria-label={`Available characters for ${raid.name}`}>
            <button type="button" className={hideAlts ? 'segment' : 'segment selected'} aria-pressed={!hideAlts} onClick={() => setHideAlts(false)}>All characters</button>
            <button type="button" className={hideAlts ? 'segment selected' : 'segment'} aria-pressed={hideAlts} onClick={() => setHideAlts(true)}>Hide alts</button>
          </div>
        </div>
      </div>
      <RaidRoster raid={raid} ctx={ctx} closed={closed} hideAlts={hideAlts} />
    </div>}
  </details>
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
