import { useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { formatRaidTime, isRaidCancelled, raidTimeOf, type AfkEntryRecord, type PlayerRecord, type RaidRecord } from '../../guildApi'
import calendarArt from '../../../Art/icons-split/calendar.png'
import './AfkCalendar.css'

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function dateKey(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatDate(value: string) {
  return parseDate(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function displayName(entry: AfkEntryRecord, roster: PlayerRecord[]) {
  return roster.find((player) => player.linkedUid === entry.userId)?.name || entry.displayName
}

export function AfkCalendar({ entries, raids, roster, currentUserId, busy, onAdd, onRemove, onEditRaid, focusRaidId }: {
  entries: AfkEntryRecord[]
  raids: RaidRecord[]
  roster: PlayerRecord[]
  currentUserId: string
  busy: boolean
  onAdd: (startDate: string, endDate: string) => Promise<boolean>
  onRemove: (entryId: string) => Promise<boolean>
  onEditRaid?: (raid: RaidRecord) => void
  focusRaidId?: string
}) {
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const focused = focusRaidId ? raids.find((raid) => raid.id === focusRaidId) : undefined
    const start = focused ? parseDate(focused.date) : new Date()
    return new Date(start.getFullYear(), start.getMonth(), 1)
  })
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [formError, setFormError] = useState('')
  const [todayKey] = useState(() => dateKey(new Date()))

  const monthStart = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1)
  const firstCalendarDay = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - monthStart.getDay())
  const calendarDays = Array.from({ length: 42 }, (_, index) => new Date(
    firstCalendarDay.getFullYear(),
    firstCalendarDay.getMonth(),
    firstCalendarDay.getDate() + index,
  ))
  const ownEntries = entries.filter((entry) => entry.userId === currentUserId)

  function shiftMonth(offset: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  }

  async function submitRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    if (!startDate || !endDate) {
      setFormError('Choose both dates for your unavailable range.')
      return
    }
    if (endDate < startDate) {
      setFormError('The end date must be the same as or later than the start date.')
      return
    }
    if (await onAdd(startDate, endDate)) {
      setStartDate('')
      setEndDate('')
    }
  }

  return <div className="afk-calendar-tool">
    <section className="afk-calendar-main" aria-label="Guild Raid Calendar">
      <header className="afk-month-toolbar">
        <div className="afk-month-heading"><img className="afk-calendar-art-icon" src={calendarArt} alt="" aria-hidden="true" /><h3>{visibleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3></div>
        <div className="afk-month-controls">
          <button className="afk-month-button" type="button" onClick={() => setVisibleMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} title="Go to current month">Today</button>
          <button className="afk-month-button afk-month-icon-button" type="button" onClick={() => shiftMonth(-1)} title="Previous month" aria-label="Previous month"><ChevronLeft size={16} /></button>
          <button className="afk-month-button afk-month-icon-button" type="button" onClick={() => shiftMonth(1)} title="Next month" aria-label="Next month"><ChevronRight size={16} /></button>
        </div>
      </header>

      <div className="afk-calendar-scroll">
        <div className="afk-calendar-grid" role="grid" aria-label={visibleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}>
          {weekdays.map((weekday) => <div className="afk-weekday" role="columnheader" key={weekday}>{weekday}</div>)}
          {calendarDays.map((date) => {
            const key = dateKey(date)
            const dayEntries = entries.filter((entry) => entry.startDate <= key && entry.endDate >= key)
            const dayRaids = raids.filter((raid) => raid.date === key).sort((a, b) => raidTimeOf(a).localeCompare(raidTimeOf(b)))
            const dayLabels = [
              ...dayRaids.map((raid) => isRaidCancelled(raid) ? `${raid.name}, cancelled` : `${raid.name}, ${raid.size}-player raid`),
              ...dayEntries.map((entry) => `${displayName(entry, roster)} unavailable`),
            ]
            return <div className={`afk-day${date.getMonth() === visibleMonth.getMonth() ? '' : ' outside-month'}${key === todayKey ? ' today' : ''}`} role="gridcell" aria-label={`${date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}${dayLabels.length ? `, ${dayLabels.join(', ')}` : ''}`} key={key}>
              <time className="afk-day-number" dateTime={key}>{date.getDate()}</time>
              <div className="afk-day-entries">{dayRaids.map((raid) => {
                const cancelled = isRaidCancelled(raid)
                const zoneLabel = raid.zones?.length ? raid.zones.map((zone) => `${zone.name} (${zone.size})`).join(', ') : `${raid.size}-player`
                const content = <><span>{raid.name}</span><small>{cancelled ? 'Cancelled' : `${zoneLabel} · ${formatRaidTime(raidTimeOf(raid))}`}</small></>
                const title = cancelled ? `${raid.name} · cancelled: ${raid.cancelReason ?? ''}` : `${raid.name} · ${zoneLabel} · ${formatRaidTime(raidTimeOf(raid))}${raid.description ? `\n${raid.description}` : ''}`
                const className = `raid-calendar-event${cancelled ? ' cancelled' : ''}${raid.id === focusRaidId ? ' focused' : ''}`
                const focusRef = raid.id === focusRaidId ? (node: HTMLElement | null) => node?.scrollIntoView({ block: 'center' }) : undefined
                return onEditRaid
                  ? <button type="button" className={className} ref={focusRef} title={`${title} · click to edit`} onClick={() => onEditRaid(raid)} key={raid.id}>{content}</button>
                  : <span className={className} ref={focusRef} title={title} key={raid.id}>{content}</span>
              })}{dayEntries.map((entry) => <span className={`afk-calendar-entry${entry.userId === currentUserId ? ' own-entry' : ''}`} title={`${displayName(entry, roster)} unavailable ${formatDate(entry.startDate)}–${formatDate(entry.endDate)}`} key={entry.id}>
                <span>{displayName(entry, roster)}</span>
              </span>)}</div>
            </div>
          })}
        </div>
      </div>
    </section>

    <aside className="afk-calendar-sidebar">
      <section className="afk-entry-section">
        <h3>Add unavailable dates</h3>
        <form className="afk-entry-form" onSubmit={(event) => void submitRange(event)}>
          <label>Date from<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
          <label>Date to<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
          {formError && <p className="afk-form-error" role="alert">{formError}</p>}
          <button className="button button-primary" type="submit" disabled={busy}><img className="afk-calendar-button-art-icon" src={calendarArt} alt="" aria-hidden="true" /> Add date range</button>
        </form>
      </section>

      <section className="afk-own-ranges">
        <h3>Your date ranges</h3>
        {ownEntries.length ? <ul>{ownEntries.map((entry) => <li key={entry.id}>
          <span><strong>{formatDate(entry.startDate)}</strong><small>to {formatDate(entry.endDate)}</small></span>
          <button type="button" className="afk-remove-button" disabled={busy} onClick={() => void onRemove(entry.id)} aria-label={`Remove unavailable dates ${formatDate(entry.startDate)} to ${formatDate(entry.endDate)}`} title="Remove date range"><Trash2 size={15} /></button>
        </li>)}</ul> : <p className="afk-no-ranges">You haven’t added any unavailable dates.</p>}
      </section>
    </aside>
  </div>
}