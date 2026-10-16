import { useId, useState } from 'react'
import type { FocusEvent, MouseEvent } from 'react'
import type { TenManTeam } from '../../guildApi'
import { slotProblems } from './calculateCoverage'
import { coverageEffects } from './coverageData'
import { coverageTiles, STRIP_DEFAULT_OPEN, statusCounts } from './coverageDisplay'
import type { CoverageTile } from './coverageDisplay'
import { assignedMembers } from './teamSelection'
import type { CoverageMember } from './types'
import './RaidCoveragePanel.css'

type Tip = { tile: CoverageTile; left: number; top?: number; bottom?: number }

const TIP_WIDTH = 260

// A collapsible icon grid for one team card or combined raid, collapsed by default with a status summary in the header.
// Renders nothing when there is no catalog.
export function RaidCoverageStrip({ parts, players, assignments }: {
  parts: TenManTeam[]
  players: CoverageMember[]
  assignments: Record<string, TenManTeam>
}) {
  const [open, setOpen] = useState(STRIP_DEFAULT_OPEN)
  const [tip, setTip] = useState<Tip | null>(null)
  const tipId = useId()
  const problems = slotProblems(coverageEffects)
  if (problems.length) return <div className="cov-strip"><p className="cov-strip-error" role="alert" title={problems.join('\n')}>Coverage catalog error: {problems.length} problem{problems.length === 1 ? '' : 's'}. See the coverage panel.</p></div>
  const tiles = coverageTiles(coverageEffects, assignedMembers(parts, players, assignments))
  if (!tiles.length) return null

  // The tooltip is fixed-position so the card cannot clip it; it opens above the icon when there is no room below.
  const show = (tile: CoverageTile, event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - TIP_WIDTH / 2, window.innerWidth - TIP_WIDTH - 8))
    const below = window.innerHeight - rect.bottom > 200
    setTip({ tile, left, ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }) })
  }

  return <details className="cov-strip" open={open} onToggle={(event) => { setOpen(event.currentTarget.open); setTip(null) }}>
    <summary className="cov-strip-head">
      <span className="cov-strip-caret" aria-hidden="true" />
      <span className="cov-strip-label">Buff &amp; debuff coverage</span>
      <span className="cov-strip-counts">{statusCounts(tiles).map((entry) => <span key={`${entry.status}-${entry.estimated}`} className={`cov-chip cov-chip-${entry.status}${entry.estimated ? ' cov-chip-est' : ''}`}><span aria-hidden="true">{entry.glyph}</span> {entry.count} {entry.label}</span>)}</span>
    </summary>
    <ul className="cov-icons" aria-label="Buff and debuff coverage" onKeyDown={(event) => { if (event.key === 'Escape') setTip(null) }}>
      {tiles.map((tile) => <li
        key={tile.key}
        tabIndex={0}
        className={`cov-icon cov-icon-${tile.status}${tile.estimated ? ' cov-icon-est' : ''}`}
        aria-label={tile.label}
        aria-describedby={tip?.tile.key === tile.key ? tipId : undefined}
        onMouseEnter={(event) => show(tile, event)}
        onMouseLeave={() => setTip(null)}
        onFocus={(event) => show(tile, event)}
        onBlur={() => setTip(null)}
      >
        <span className="cov-icon-fallback" aria-hidden="true">{tile.initials}</span>
        {tile.iconUrl && <img src={tile.iconUrl} alt="" width={32} height={32} loading="lazy" draggable={false} onError={(event) => { event.currentTarget.hidden = true }} />}
        <span className="cov-icon-badge" aria-hidden="true">{tile.glyph}</span>
      </li>)}
    </ul>
    {tip && <div className="cov-tip" id={tipId} role="tooltip" style={{ left: tip.left, top: tip.top, bottom: tip.bottom, width: TIP_WIDTH }}>
      <strong>{tip.tile.spellName}</strong>
      <span className={tip.tile.descriptionAvailable ? undefined : 'cov-tip-unavailable'}>{tip.tile.description}</span>
    </div>}
  </details>
}
