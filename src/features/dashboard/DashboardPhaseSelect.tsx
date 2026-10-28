import { phaseLabel, type PhaseOption } from '../../shared/game/phases'
import './DashboardPhase.css'

// The phase choice of My loot priorities and of My awarded loot (MEMBER-008), a labeled select like the Phase selector on Loot priorities: each option's label says
// whether the phase is the current one or finished. Each card has its own, so `label` says which one it is (the page has two).
export function DashboardPhaseSelect({ label, options, value, onChange }: { label: string; options: PhaseOption[]; value: number; onChange: (no: number) => void }) {
  return <label className="dash-phase">
    <span className="dash-phase-label">Phase</span>
    <select aria-label={label} value={value} onChange={(event) => onChange(Number(event.target.value))}>
      {options.map((option) => <option key={option.no} value={option.no}>{phaseLabel(option)}</option>)}
    </select>
  </label>
}
