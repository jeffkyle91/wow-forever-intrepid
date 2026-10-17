import type { CSSProperties } from 'react'
import { ArrowDown, ArrowUp, Check, ClipboardList, Pencil } from 'lucide-react'
import type { AwardRecord as Award, PriorityRecord as LootPriority } from '../../guildApi'
import { encounterArt, lootArt } from '../../shared/art'
import { ArtIcon } from '../../shared/ui/ArtIcon'
import { ItemTooltip } from '../../shared/ui/ItemTooltip'
import { classAccent } from '../../shared/game/classes'
import { listingProgress } from './completion'
import './PriorityList.css'

export function PriorityList({ priorities, awards, classOf, canEdit, busy, onEdit, onAward, onMoveCandidate }: { priorities: LootPriority[]; awards: Award[]; classOf: (name: string) => string | undefined; canEdit: boolean; busy: boolean; onEdit: (priority: LootPriority) => void; onAward: (priority: LootPriority) => void; onMoveCandidate: (priority: LootPriority, index: number, direction: -1 | 1) => void }) {
  return <div className="priority-list">{priorities.map((priority, index) => {
    const progress = listingProgress(priority, awards)
    const recentAward = awards.filter((award) => award.item === priority.item).sort((a, b) => b.awardedAt.localeCompare(a.awardedAt))[0]
    return <article className={progress.complete ? 'priority-row stagger-row complete' : 'priority-row stagger-row'} key={priority.id} style={{ '--row-index': index } as CSSProperties}>
      <div className="priority-main"><div className="priority-item-line">{!priority.itemId && <span className="item-gem"><ArtIcon src={lootArt} className="priority-loot-icon" /></span>}<div><h3>{priority.itemId ? <ItemTooltip itemId={priority.itemId} fallbackName={priority.item} /> : priority.item}</h3><span className="encounter-label"><ArtIcon src={encounterArt} className="encounter-art-icon" /> {priority.encounter}</span></div></div><p className="council-note">{priority.councilNote || <span className="muted">No council note yet</span>}</p></div>
      <div className="priority-ranking"><div className="ranking-heading"><span>COUNCIL ORDER</span><span className="rank-count">{priority.rankedPlayers.length ? `${priority.rankedPlayers.length} ranked` : <span className="needs-players">Needs players</span>}{progress.complete && <span className="complete-tag">COMPLETE</span>}</span></div>
        {priority.rankedPlayers.length ? <ol>{priority.rankedPlayers.map((name, rank) => <li key={`${name}-${rank}`} className={[progress.received[rank] ? 'listing-received' : '', classOf(name) ? classAccent(classOf(name)!) : ''].filter(Boolean).join(' ') || undefined}><span className={rank === progress.next ? 'rank-number first' : 'rank-number'}>{String(rank + 1).padStart(2, '0')}</span><span className="ranked-name">{name}</span>{progress.received[rank] && <span className="received-tag"><Check size={10} /> RECEIVED</span>}{rank === progress.next && <span className="top-pick">{rank === 0 ? 'TOP PICK' : 'NEXT UP'}</span>}{canEdit && <span className="rank-reorder"><button onClick={() => onMoveCandidate(priority, rank, -1)} disabled={busy || rank === 0} title="Move up" aria-label={`Move ${name} up`}><ArrowUp size={13} /></button><button onClick={() => onMoveCandidate(priority, rank, 1)} disabled={busy || rank === priority.rankedPlayers.length - 1} title="Move down" aria-label={`Move ${name} down`}><ArrowDown size={13} /></button></span>}</li>)}</ol> : <div className="unranked">Needs players{canEdit && <>: use Assign players to add them in order.</>}</div>}
      </div>
      {canEdit && <div className="priority-actions">{recentAward && <span className="awarded-tag"><Check size={13} /> Last awarded {new Date(`${recentAward.awardedAt}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}{!priority.rankedPlayers.length && <button className="button button-secondary" onClick={() => onEdit(priority)} disabled={busy}>Assign players</button>}<button className="button button-award" onClick={() => onAward(priority)} disabled={busy || !priority.rankedPlayers.length}><Check size={14} /> Award loot</button><button className="row-action" onClick={() => onEdit(priority)} title="Edit priority" aria-label={`Edit priority for ${priority.item}`}><Pencil size={15} /></button></div>}
    </article>
  })}{!priorities.length && <div className="empty-state"><span className="empty-icon"><ClipboardList size={21} /></span><strong>No priorities found</strong><p>Add a loot item or adjust your search or filters.</p></div>}</div>
}
