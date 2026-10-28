import { phaseLabel, type PhaseOption } from '../../shared/game/phases'
import './DashboardPhase.css'

// The phase choice of My loot priorities and My awarded loot (MEMBER-008), a labeled select like the Phase selector on Loot priorities: each option's label says
// whether the phase is the current one or finished.
export function DashboardPhaseSelect({ options, value, onChange }: { options: PhaseOption[]; value: number; onChange: (no: number) => void }) {
  return <label className="dash-phase">
    <span className="dash-phase-label">Phase</span>
    <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
      {options.map((option) => <option key={option.no} value={option.no}>{phaseLabel(option)}</option>)}
    </select>
  </label>
}
