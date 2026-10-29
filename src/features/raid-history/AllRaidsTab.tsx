import { useEffect, useState } from 'react'
import { formatRaidTime, raidTimeOf, type RaidRecord } from '../../guildApi'
import { RAID_CATEGORIES, raidCategoryLabel, type RaidCategory } from '../../shared/raids/raidCategory'
import type { TabContext } from '../../shared/tabs/types'
import { categorizedRaids, categoryCounts, inCategory, inMonth, monthLabel, PAGE_SIZE, raidMonths, type CategoryFilter } from './raidList'

const MINUTE = 60_000
const filterOptions: CategoryFilter[] = ['all', ...RAID_CATEGORIES]

const dateLabel = (date: string) => {
  const day = new Date(`${date}T12:00:00Z`)
  return Number.isNaN(day.getTime()) ? date : day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/**
 * Every raid with its category, newest first (RAID-019). It reads only the raids the app has already loaded (`ctx.data.raids`), so it adds no Firestore read; the start
 * snapshots stay in Audit Info.
 */
export function AllRaidsTab({ ctx }: { ctx: TabContext }) {
  const [now, setNow] = useState(Date.now)
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [month, setMonth] = useState('')
  const [shown, setShown] = useState(PAGE_SIZE)
  // A raid's category moves on with the clock (at its start, and 5 hours later), so the list looks again every minute.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE)
    return () => window.clearInterval(timer)
  }, [])

  if (ctx.data.dataError) return <p role="alert">Raids could not be loaded: {ctx.data.dataError}. Reload to retry.</p>
  if (!ctx.data.raidPlanningLoaded) return <p role="status">Loading raids...</p>

  const all = categorizedRaids(ctx.data.raids, now, raidTimeOf)
  const months = raidMonths(ctx.data.raids)
  const ofMonth = inMonth(all, month)
  const counts = categoryCounts(ofMonth)
  const matching = inCategory(ofMonth, category)
  const visible = matching.slice(0, shown)

  return <div className="raid-history-all">
    <div className="raid-history-filters">
      <div className="segmented-control" role="group" aria-label="Show raids by category">
        {filterOptions.map((option) => <button type="button" key={option} className={option === category ? 'segment selected' : 'segment'} aria-pressed={option === category}
          onClick={() => { setCategory(option); setShown(PAGE_SIZE) }}>{option === 'all' ? 'All' : raidCategoryLabel[option]}<span>{counts[option]}</span></button>)}
      </div>
      <label className="raid-history-month">Month
        <select value={month} onChange={(event) => { setMonth(event.target.value); setShown(PAGE_SIZE) }}>
          <option value="">All months</option>
          {months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}
        </select>
      </label>
    </div>
    {!all.length
      ? <div className="empty-state raid-history-empty"><strong>No raids yet</strong><p>Raids scheduled on the Guild Calendar appear here, newest first.</p></div>
      : !matching.length
        ? <p className="raid-history-none" role="status">No raids match these filters.</p>
        : <>
          <ul className="raid-history-raids" aria-label="Raids, newest first">
            {visible.map((entry) => <RaidLine key={entry.raid.id} raid={entry.raid} category={entry.category} />)}
          </ul>
          <div className="raid-history-more">
            <span>Showing {visible.length} of {matching.length} {matching.length === 1 ? 'raid' : 'raids'}</span>
            {visible.length < matching.length && <button type="button" className="button button-secondary" onClick={() => setShown((current) => current + PAGE_SIZE)}>Show more</button>}
          </div>
        </>}
  </div>
}

function RaidLine({ raid, category }: { raid: RaidRecord; category: RaidCategory }) {
  const zones = raid.zones ?? []
  return <li className="raid-history-raid">
    <div className="raid-history-raid-text">
      <strong>{raid.name}</strong>
      <small>{dateLabel(raid.date)} · {formatRaidTime(raidTimeOf(raid))} · {zones.length ? zones.map((zone) => `${zone.name} (${zone.size})`).join(', ') : `${raid.size}-player`}</small>
      {category === 'cancelled' && raid.cancelReason && <small>Reason: {raid.cancelReason}</small>}
    </div>
    <span className={`raid-history-category raid-history-category-${category}`}>{raidCategoryLabel[category]}</span>
  </li>
}
