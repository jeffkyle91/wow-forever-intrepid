import { useEffect, useState } from 'react'
import { subscribeAuditLog } from '../../guildApi'
import { legacyAwardEntry, type AuditEntry } from '../../shared/game/lootAudit'
import { phaseName } from '../../shared/game/phases'
import { requestItem } from '../../shared/lib/itemInfo'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'
import { describeEntry } from './auditText'
import { bossOrder } from './bossOrder'
import { encounterOptions } from './groupPriorities'
import { logFacts, logFilterActive, logPlayers, matchesLogFilter, noLogFilter, type LogFilter } from './logFilters'
import { slotChoices } from './slots'
import { useSlotOf } from './useSlotOf'
import './LootFilters.css'
import './AuditLog.css'

type Show = 'both' | 'priority' | 'award'
const shows: { value: Show; label: string }[] = [{ value: 'both', label: 'Both' }, { value: 'priority', label: 'Priorities' }, { value: 'award', label: 'Awards' }]
const STEP = 100
// The indent of a boss under its dungeon in the encounter list.
const indent = '\u00a0\u00a0\u00a0\u00a0'

// A short time for the list: no year for the current year. The row that opens has the full time.
function whenOf(at: Date | null) {
  if (!at) return 'Just now'
  const sameYear = at.getFullYear() === new Date().getFullYear()
  return at.toLocaleString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' })
}

const timeOf = (entry: AuditEntry) => (entry.at ? entry.at.getTime() : Number.MAX_SAFE_INTEGER)

// Every change to a loot priority or an award, newest first, for every guild role: the Log. It is written by the same batch as the change and the
// rules check that each entry tells the truth, and nobody can edit or delete an entry. It listens only while this dialog is open. Awards made
// before the Log began have no entry, so they are added from the awards themselves, dated the raid night, so no award is missing from it.
export function AuditLogModal({ close, live }: { close: () => void; live: TabContext }) {
  const [show, setShow] = useState<Show>('both')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LogFilter>(noLogFilter)
  const [newestFirst, setNewestFirst] = useState(true)
  const slotOf = useSlotOf()
  const [limit, setLimit] = useState(STEP)
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => subscribeAuditLog(limit, (list) => { setEntries(list); setError('') }, (problem) => setError(problem.message)), [limit])

  const name = (no: number) => phaseName(live.data.settings, no)
  // A phase started or reopened changes which lists are current, so it is shown with the priorities.
  const wanted = (type: string) => (show === 'both' ? type === 'priority' || type === 'award' || type === 'phase' : show === 'priority' ? type === 'priority' || type === 'phase' : type === 'award')
  const earlier = live.data.awards.filter((award) => award.rev === undefined).map(legacyAwardEntry)
  const text = query.trim().toLowerCase()
  const priorities = new Map(live.data.allPriorities.map((priority) => [priority.id, priority]))
  const everything = [...(entries ?? []), ...earlier].filter((entry) => wanted(entry.targetType)).map((entry) => ({ entry, facts: logFacts(entry, (id) => priorities.get(id)) }))
  // The dropdowns offer what the entries are about; looking the items up is what lets the slot filter tell which ones match.
  const itemKey = [...new Set(everything.flatMap(({ facts }) => (facts.itemId ? [facts.itemId] : [])))].join(',')
  useEffect(() => { if (itemKey) itemKey.split(',').forEach((id) => requestItem(Number(id))) }, [itemKey])
  const players = logPlayers(everything.map(({ facts }) => facts), filter.player)
  const encounters = encounterOptions(everything.filter(({ facts }) => facts.encounter).map(({ facts }) => ({ encounter: facts.encounter })), bossOrder)
  if (filter.encounter && !encounters.some((option) => option.value === filter.encounter)) encounters.push({ value: filter.encounter, label: filter.encounter.slice(2).replace('|', ' \u00b7 '), level: 0 })
  const rows = everything
    .filter(({ facts }) => matchesLogFilter(facts, filter, slotOf))
    .sort((a, b) => (newestFirst ? timeOf(b.entry) - timeOf(a.entry) : timeOf(a.entry) - timeOf(b.entry)))
    .map(({ entry }) => ({ entry, ...describeEntry(entry, name) }))
    .filter(({ entry, title, details }) => !text || [title, entry.byName, ...details].join(' ').toLowerCase().includes(text))
  const more = entries !== null && entries.length >= limit
  const narrowed = !!text || logFilterActive(filter)

  return <Modal title="Log" onClose={close}><div className="audit-log">
    <p className="audit-intro">Every change to a loot priority or an award, newest first. Open a line to see who made it and what changed. Nobody can edit or delete an entry.</p>
    <div className="audit-controls">
      <div className="segmented-control audit-toggle" role="group" aria-label="What to show">
        {shows.map((option) => <button key={option.value} type="button" className={show === option.value ? 'segment selected' : 'segment'} aria-pressed={show === option.value} onClick={() => setShow(option.value)}>{option.label}</button>)}
      </div>
      <input className="audit-search" type="search" aria-label="Find in the Log" placeholder="Find an item or a player..." value={query} onChange={(event) => setQuery(event.target.value)} />
    </div>
    <div className="audit-controls">
      <select className="loot-filter-select" aria-label="Filter by player" value={filter.player} onChange={(event) => setFilter({ ...filter, player: event.target.value })}>
        <option value="">All players</option>
        {players.map((player) => <option key={player} value={player}>{player}</option>)}
      </select>
      <select className="loot-filter-select" aria-label="Filter by item slot" value={filter.slot} onChange={(event) => setFilter({ ...filter, slot: event.target.value })}>
        <option value="">All slots</option>
        {slotChoices.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
      </select>
      <select className="loot-filter-select" aria-label="Filter by dungeon or boss" value={filter.encounter} onChange={(event) => setFilter({ ...filter, encounter: event.target.value })}>
        <option value="">All encounters</option>
        {encounters.map((option) => <option key={option.value} value={option.value}>{option.level === 1 ? indent : ''}{option.label}</option>)}
      </select>
      <select className="loot-filter-select" aria-label="Order" value={newestFirst ? 'newest' : 'oldest'} onChange={(event) => setNewestFirst(event.target.value === 'newest')}>
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
      </select>
      {(narrowed) && <button type="button" className="loot-filter-clear" onClick={() => { setFilter(noLogFilter); setQuery('') }}>Clear filters</button>}
    </div>
    {error && <p className="audit-error" role="alert">The Log could not be read: {error}</p>}
    {!error && entries === null && <p className="audit-empty">Loading...</p>}
    {entries !== null && rows.length === 0 && <p className="audit-empty">{narrowed ? 'Nothing here matches.' : 'Nothing has been logged yet.'}{narrowed && more ? ' Load older entries to look further back.' : ''}</p>}
    <ol className="audit-list">{rows.map(({ entry, title, details }) => {
      // One line each: what happened and when. Who did it and the fields are in the row that opens.
      return <li key={entry.id} className={`audit-entry audit-${entry.targetType}`}>
        <details>
          <summary><span className="audit-title" title={title}>{title}</span><time className="audit-when">{entry.rev === 0 && entry.at ? entry.at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : whenOf(entry.at)}</time></summary>
          <div className="audit-body">
            <p>{entry.rev === 0 ? 'Recorded before the Log began (dated the raid night)' : <>By <strong>{entry.byName || 'Unknown'}</strong>{' '}{'\u00b7'}{' '}{entry.targetType === 'award' ? 'Award' : entry.targetType === 'phase' ? 'Phase' : 'Priority'}{entry.at ? ` \u00b7 ${entry.at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })}` : ''}</>}</p>
            {details.length > 0 && <ul>{details.map((line) => <li key={line}>{line}</li>)}</ul>}
          </div>
        </details>
      </li>
    })}</ol>
    {narrowed && rows.length > 0 && <p className="audit-count">{rows.length} {rows.length === 1 ? 'entry matches' : 'entries match'}{more ? `, in the newest ${entries?.length ?? 0} entries` : ''}.</p>}
    {more && <button type="button" className="button button-secondary audit-more" onClick={() => setLimit((current) => current + STEP)}>Load older entries</button>}
  </div></Modal>
}
