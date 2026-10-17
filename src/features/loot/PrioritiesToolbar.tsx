import { currentPhaseNo, phaseLabel, phaseOptions } from '../../shared/game/phases'
import type { TabContext } from '../../shared/tabs/types'
import { filterOptions } from './filters'
import { encounterOptions } from './groupPriorities'
import { clearPriorityFilters, filtersActive, setPriorityFilters, usePriorityFilters } from './priorityFilters'
import { slotChoices } from './slots'
import { useBossOrder } from './useDropTables'
import { usePhaseView } from './usePhaseView'
import './LootFilters.css'

// The indent of a boss under its dungeon in the encounter list.
const indent = '\u00a0\u00a0\u00a0\u00a0'

export function PrioritiesToolbar({ ctx }: { ctx: TabContext }) {
  const filters = usePriorityFilters()
  const { view, priorities } = usePhaseView(ctx)
  const bossOrder = useBossOrder(ctx.data.lootTables, view.no)
  const phases = phaseOptions(ctx.data.settings, ctx.identity.canEditRaidData)
  const options = filterOptions(priorities, filters)
  // Each dungeon, then its bosses below it. The current choice is always offered, so it can be cleared if its priorities are gone.
  const encounters = encounterOptions(priorities, bossOrder)
  if (filters.encounter && !encounters.some((option) => option.value === filters.encounter)) encounters.push({ value: filters.encounter, label: filters.encounter.slice(2).replace('|', ' \u00b7 '), level: 0 })
  return <div className="loot-filters">
    {phases.length > 1 && <select className="loot-filter-select" aria-label="Phase" value={view.no} onChange={(event) => { const no = Number(event.target.value); setPriorityFilters({ phase: no === currentPhaseNo(ctx.data.settings) ? null : no }) }}>
      {phases.map((option) => <option key={option.no} value={option.no}>{phaseLabel(option)}</option>)}
    </select>}
    <div className="segmented-control" role="group" aria-label="Loot list view">
      <button className={filters.hideCompleted ? 'segment' : 'segment selected'} onClick={() => setPriorityFilters({ hideCompleted: false })} aria-pressed={!filters.hideCompleted}>All items</button>
      <button className={filters.hideCompleted ? 'segment selected' : 'segment'} onClick={() => setPriorityFilters({ hideCompleted: true })} aria-pressed={filters.hideCompleted}>Hide completed</button>
    </div>
    <div className="segmented-control" role="group" aria-label="Loot list layout">
      <button className={filters.grouped ? 'segment selected' : 'segment'} onClick={() => setPriorityFilters({ grouped: true })} aria-pressed={filters.grouped}>By boss</button>
      <button className={filters.grouped ? 'segment' : 'segment selected'} onClick={() => setPriorityFilters({ grouped: false })} aria-pressed={!filters.grouped}>One list</button>
    </div>
    <select className="loot-filter-select" aria-label="Filter by dungeon or boss" value={filters.encounter} onChange={(event) => setPriorityFilters({ encounter: event.target.value })}>
      <option value="">All encounters</option>
      {encounters.map((option) => <option key={option.value} value={option.value}>{option.level === 1 ? indent : ''}{option.label}</option>)}
    </select>
    <select className="loot-filter-select" aria-label="Filter by item slot" value={filters.slot} onChange={(event) => setPriorityFilters({ slot: event.target.value })}>
      <option value="">All slots</option>
      {slotChoices.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
    </select>
    <select className="loot-filter-select" aria-label="Filter by player" value={filters.player} onChange={(event) => setPriorityFilters({ player: event.target.value })}>
      <option value="">All players</option>
      {options.players.map((name) => <option key={name} value={name}>{name}</option>)}
    </select>
    {filtersActive(filters) && <button className="loot-filter-clear" onClick={clearPriorityFilters}>Clear filters</button>}
  </div>
}
