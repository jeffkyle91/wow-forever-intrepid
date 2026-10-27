import { useEffect, useState } from 'react'
import { raidTimeOf } from '../../guildApi'
import type { TabContext } from '../../shared/tabs/types'
import './ScheduledRaids.css'
import { groupScheduledRaids, isClosedRaid, nextStartAfter, raidRowId } from './groupRaids'
import { RaidRow } from './RaidRow'

const MINUTE = 60_000

export function ScheduledRaidsTab({ ctx }: { ctx: TabContext }) {
  const [now, setNow] = useState(Date.now)
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set())
  const [olderOpen, setOlderOpen] = useState(false)
  const [seenParam, setSeenParam] = useState<string | undefined>()
  const loaded = ctx.data.raidPlanningLoaded
  const raids = [...ctx.data.raids].sort((a, b) => a.date.localeCompare(b.date) || raidTimeOf(a).localeCompare(raidTimeOf(b)) || a.id.localeCompare(b.id))
  const nextStart = nextStartAfter(raids, now)
  // The clock only has to move when a raid starts (its row then says so and goes read-only), so wait for that moment rather than re-rendering every open row each second.
  useEffect(() => {
    const wait = nextStart === undefined ? MINUTE : Math.min(MINUTE, Math.max(nextStart - Date.now() + 250, 250))
    const timer = window.setTimeout(() => setNow(Date.now()), wait)
    return () => window.clearTimeout(timer)
  }, [now, nextStart])
  // A raid named by the navigation (the sign-up dialog's "Open Scheduled Raids") opens its row, and its group when it is an older one. An id that matches no raid opens nothing.
  if (loaded && ctx.navParam !== seenParam) {
    setSeenParam(ctx.navParam)
    const target = ctx.navParam === undefined ? undefined : raids.find((raid) => raid.id === ctx.navParam)
    if (target) {
      setOpenIds((current) => new Set(current).add(target.id))
      if (isClosedRaid(target, now)) setOlderOpen(true)
    }
  }
  useEffect(() => {
    if (loaded && ctx.navParam) document.getElementById(raidRowId(ctx.navParam))?.scrollIntoView({ block: 'start' })
  }, [loaded, ctx.navParam])
  if (ctx.data.dataError) return <p role="alert">Scheduled raids could not be loaded: {ctx.data.dataError}. Reload to retry.</p>
  if (!loaded) return <p role="status">Loading scheduled raids...</p>
  if (ctx.data.unreadable) return <p role="alert">Some guild records are unreadable. Correct them before viewing scheduled raids.</p>
  if (!raids.length) return <p>No scheduled raids yet. <button className="button button-secondary" onClick={() => ctx.navigate('afk')}>Open Guild Calendar</button></p>
  const { upcoming, older } = groupScheduledRaids(raids, now)
  const toggle = (raidId: string, open: boolean) => setOpenIds((current) => {
    if (current.has(raidId) === open) return current
    const next = new Set(current)
    if (open) next.add(raidId)
    else next.delete(raidId)
    return next
  })
  const row = (raid: (typeof raids)[number]) => <RaidRow key={raid.id} raid={raid} ctx={ctx} closed={isClosedRaid(raid, now)} open={openIds.has(raid.id)} onToggle={toggle} />
  return <div className="scheduled-raids-tool">
    {upcoming.length
      ? <div className="scheduled-raids-list">{upcoming.map(row)}</div>
      : <p>No upcoming scheduled raids. <button className="button button-secondary" onClick={() => ctx.navigate('afk')}>Open Guild Calendar</button></p>}
    {older.length > 0 && <details className="raid-older" open={olderOpen} onToggle={(event) => { if (event.target === event.currentTarget) setOlderOpen(event.currentTarget.open) }}>
      <summary className="raid-older-summary"><span className="raid-row-caret" aria-hidden="true" />Past and cancelled raids<span className="raid-older-count">{older.length}</span></summary>
      {olderOpen && <div className="scheduled-raids-list">{older.map(row)}</div>}
    </details>}
  </div>
}
