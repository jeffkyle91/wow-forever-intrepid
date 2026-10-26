import { useState } from 'react'
import { HelpPopover } from '../../shared/ui/HelpPopover'
import type { StandingTeam } from '../../guildApi'
import { slotProblems } from './calculateCoverage'
import { consumableAlternatives } from './consumableData'
import { parsePlans, PLANS_STORAGE_KEY, plannedIds, togglePlan } from './consumables'
import { coverageEffects } from './coverageData'
import { coverageTiles, STRIP_DEFAULT_OPEN, statusCounts, visualTreatments } from './coverageDisplay'
import { assignedMembers } from './teamSelection'
import type { CoverageMember } from './types'
import './RaidCoveragePanel.css'

const readPlans = () => {
  try { return parsePlans(localStorage.getItem(PLANS_STORAGE_KEY)) } catch { return {} }
}

// A collapsible icon grid for one independent standing team, collapsed by default with a status summary in the header.
// Renders nothing when there is no catalog.
export function RaidCoverageStrip({ parts, players, assignments }: {
  parts: StandingTeam[]
  players: CoverageMember[]
  assignments: Record<string, StandingTeam>
}) {
  const [open, setOpen] = useState(STRIP_DEFAULT_OPEN)
  const scope = parts.join('+')
  const [plans, setPlans] = useState(readPlans)
  const planned = plannedIds(plans, scope, consumableAlternatives)
  const problems = slotProblems(coverageEffects)
  if (problems.length) return <div className="cov-strip"><p className="cov-strip-error" role="alert">Coverage catalog error: {problems.length} problem{problems.length === 1 ? '' : 's'}. See the coverage panel.</p><ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul></div>
  const tiles = coverageTiles(coverageEffects, assignedMembers(parts, players, assignments), { consumables: consumableAlternatives, planned })
  if (!tiles.length) return null

  // Plans stay on this device. Re-read storage first so another card's change is not overwritten.
  const setPlanned = (id: string, on: boolean) => {
    const next = togglePlan(readPlans(), scope, id, on)
    setPlans(next)
    try { localStorage.setItem(PLANS_STORAGE_KEY, JSON.stringify(next)) } catch { /* private mode: the plan lasts until reload */ }
  }
  const options = tiles.flatMap((tile) => tile.consumableOptions.map((consumable) => ({ tile, consumable })))

  return <details className="cov-strip" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cov-strip-head">
      <span className="cov-strip-caret" aria-hidden="true" />
      <span className="cov-strip-label">Buff &amp; debuff coverage</span>
      <span className="cov-strip-counts">{statusCounts(tiles).map((entry) => <span key={entry.status} className={`cov-chip cov-chip-${entry.status}`}><span aria-hidden="true">{entry.glyph}</span> {entry.count} {entry.label}</span>)}</span>
    </summary>
    <ul className="cov-icons" aria-label="Buff and debuff coverage">
      {tiles.map((tile) => <li key={tile.key}>
        <HelpPopover label={tile.label} triggerClassName={`cov-icon cov-icon-${tile.status} cov-icon-visual-${tile.visual}`} trigger={<>
        <span className="cov-icon-fallback" aria-hidden="true">{tile.initials}</span>
        {tile.iconUrl && <img src={tile.iconUrl} alt="" width={32} height={32} style={visualTreatments[tile.visual]} loading="lazy" draggable={false} onError={(event) => { event.currentTarget.hidden = true }} />}
        </>}>
          <strong>{tile.spellName}</strong>
          <p>{tile.description}</p>
          <p>{tile.lines.join('\n')}</p>
        </HelpPopover>
      </li>)}
    </ul>
    {options.length > 0 && <fieldset className="cov-consumables">
      <legend>Planned consumables (this device only, not shared)</legend>
      {options.map(({ tile, consumable }) => <label key={consumable.id}>
        <input type="checkbox" checked={planned.has(consumable.id)} onChange={(event) => setPlanned(consumable.id, event.target.checked)} />
        <span><strong>{consumable.name}</strong> for {tile.name}: {consumable.effect} Weaker or different: {consumable.limitation}</span>
      </label>)}
    </fieldset>}
  </details>
}
