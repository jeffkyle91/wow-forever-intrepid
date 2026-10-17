import { useEffect, useState } from 'react'
import { subscribeAuditLog } from '../../guildApi'
import type { AuditEntry } from '../../shared/game/lootAudit'
import { phaseName } from '../../shared/game/phases'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'
import { describeEntry } from './auditText'
import './AuditLog.css'

type Show = 'both' | 'priority' | 'award'
const shows: { value: Show; label: string }[] = [{ value: 'both', label: 'Both' }, { value: 'priority', label: 'Priorities' }, { value: 'award', label: 'Awards' }]
const STEP = 100

// A short time for the list: no year for the current year. The row that opens has the full time.
function whenOf(at: Date | null) {
  if (!at) return 'Just now'
  const sameYear = at.getFullYear() === new Date().getFullYear()
  return at.toLocaleString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' })
}

// Every change to a loot priority or an award, newest first, for every guild role. The log is written by the same batch as the change and the
// rules check that each entry tells the truth, and nobody can edit or delete an entry. It listens only while this dialog is open.
export function AuditLogModal({ close, live }: { close: () => void; live: TabContext }) {
  const [show, setShow] = useState<Show>('both')
  const [limit, setLimit] = useState(STEP)
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => subscribeAuditLog(limit, (list) => { setEntries(list); setError('') }, (problem) => setError(problem.message)), [limit])

  const name = (no: number) => phaseName(live.data.settings, no)
  const shown = (entries ?? []).filter((entry) => (show === 'both' ? entry.targetType === 'priority' || entry.targetType === 'award' : entry.targetType === show))
  const more = entries !== null && entries.length >= limit

  return <Modal title="Change log" onClose={close}><div className="audit-log">
    <p className="audit-intro">Every change to a loot priority or an award, newest first. Open a line to see who made it and what changed. Nobody can edit or delete an entry.</p>
    <div className="segmented-control audit-toggle" role="group" aria-label="What to show">
      {shows.map((option) => <button key={option.value} type="button" className={show === option.value ? 'segment selected' : 'segment'} aria-pressed={show === option.value} onClick={() => setShow(option.value)}>{option.label}</button>)}
    </div>
    {error && <p className="audit-error" role="alert">The change log could not be read: {error}</p>}
    {!error && entries === null && <p className="audit-empty">Loading...</p>}
    {entries !== null && shown.length === 0 && <p className="audit-empty">{entries.length === 0 ? 'Nothing has been logged yet.' : `No ${show === 'both' ? 'loot' : show === 'priority' ? 'priority' : 'award'} changes in the newest ${entries.length} entries.`}</p>}
    <ol className="audit-list">{shown.map((entry) => {
      const { title, details } = describeEntry(entry, name)
      // One line each: what happened and when. Who did it and the fields are in the row that opens.
      return <li key={entry.id} className={`audit-entry audit-${entry.targetType}`}>
        <details>
          <summary><span className="audit-title" title={title}>{title}</span><time className="audit-when">{whenOf(entry.at)}</time></summary>
          <div className="audit-body">
            <p>By <strong>{entry.byName || 'Unknown'}</strong>{' '}{'\u00b7'}{' '}{entry.targetType === 'award' ? 'Award' : 'Priority'}{entry.at ? ` \u00b7 ${entry.at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })}` : ''}</p>
            {details.length > 0 && <ul>{details.map((line) => <li key={line}>{line}</li>)}</ul>}
          </div>
        </details>
      </li>
    })}</ol>
    {more && <button type="button" className="button button-secondary audit-more" onClick={() => setLimit((current) => current + STEP)}>Load older entries</button>}
  </div></Modal>
}
