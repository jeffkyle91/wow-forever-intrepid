import { currentPhaseNo, phaseLabel, phaseOptions } from '../../shared/game/phases'
import type { TabContext } from '../../shared/tabs/types'
import { setPriorityFilters } from './priorityFilters'
import { usePhaseView } from './usePhaseView'
import './PhasePicker.css'

// Which loot phase the page is showing, up by the page title where it cannot be missed: everything below (the lists, the filters, Browse drops, Carry over,
// the Log) is about this phase. The option says what kind of phase it is: current, next (being prepared, leaders only) or finished (read-only).
// With a single phase there is nothing to pick, and it is named instead.
export function PhasePicker({ ctx }: { ctx: TabContext }) {
  const { view } = usePhaseView(ctx)
  const phases = phaseOptions(ctx.data.settings, ctx.identity.canEditRaidData)
  return <div className="phase-picker" data-kind={view.kind}>
    <span className="phase-picker-label">PHASE</span>
    {phases.length > 1
      ? <select aria-label="Phase" value={view.no} onChange={(event) => { const no = Number(event.target.value); setPriorityFilters({ phase: no === currentPhaseNo(ctx.data.settings) ? null : no }) }}>
        {phases.map((option) => <option key={option.no} value={option.no}>{phaseLabel(option)}</option>)}
      </select>
      : <strong className="phase-picker-name">{phaseLabel(view)}</strong>}
  </div>
}
