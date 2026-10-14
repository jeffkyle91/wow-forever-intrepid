import type { CSSProperties } from 'react'
import { CalendarDays, CircleUserRound } from 'lucide-react'
import type { AwardRecord as Award } from '../../guildApi'
import { EmptyRow } from '../../shared/ui/EmptyRow'

export function AwardHistory({ awards }: { awards: Award[] }) {
  return <div className="table-scroll"><table className="data-table history-table"><thead><tr><th>ITEM / ENCOUNTER</th><th>RECIPIENT</th><th>AWARDED</th><th>COUNCIL ORDER AT AWARD</th><th>DECISION NOTE</th></tr></thead><tbody>
    {awards.map((award, index) => <tr key={award.id} className="stagger-row" style={{ '--row-index': index } as CSSProperties}>
      <td><strong className="history-item">{award.item}</strong><span className="table-subtext">{award.encounter}</span></td><td><span className="character-cell"><span className="class-avatar recipient-avatar"><CircleUserRound size={14} /></span><strong>{award.recipient}</strong></span></td>
      <td><span className="date-cell"><CalendarDays size={14} /> {new Date(`${award.awardedAt}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span></td>
      <td><span className="snapshot-order">{award.prioritySnapshot.map((name, rank) => <span key={`${name}-${rank}`}><b>{rank + 1}</b>{name}</span>)}</span><span className="table-subtext">{award.councilNoteSnapshot || 'No note at time of award'}</span></td><td className="award-note-cell">{award.awardNote || <span className="muted">—</span>}</td>
    </tr>)}
    {!awards.length && <EmptyRow colSpan={5} title="No awards recorded" detail="Awards recorded from the priority list will appear here." />}
  </tbody></table></div>
}
