import type { TabContext } from '../../shared/tabs/types'
import { filterOptions } from './filters'
import { clearPriorityFilters, filtersActive, setPriorityFilters, usePriorityFilters } from './priorityFilters'
import './LootFilters.css'

export function PrioritiesToolbar({ ctx }: { ctx: TabContext }) {
  const filters = usePriorityFilters()
  const options = filterOptions(ctx.data.priorities, ctx.data.roster, filters)
  return <div className="loot-filters">
    <div className="segmented-control" role="group" aria-label="Loot list view">
      <button className={filters.hideCompleted ? 'segment' : 'segment selected'} onClick={() => setPriorityFilters({ hideCompleted: false })} aria-pressed={!filters.hideCompleted}>All items</button>
      <button className={filters.hideCompleted ? 'segment selected' : 'segment'} onClick={() => setPriorityFilters({ hideCompleted: true })} aria-pressed={filters.hideCompleted}>Hide completed</button>
    </div>
    <div className="segmented-control" role="group" aria-label="Items without players">
      <button className={filters.needsPlayers ? 'segment selected' : 'segment'} onClick={() => setPriorityFilters({ needsPlayers: !filters.needsPlayers })} aria-pressed={filters.needsPlayers}>Needs players</button>
    </div>
    <div className="segmented-control" role="group" aria-label="Loot list layout">
      <button className={filters.grouped ? 'segment selected' : 'segment'} onClick={() => setPriorityFilters({ grouped: true })} aria-pressed={filters.grouped}>By boss</button>
      <button className={filters.grouped ? 'segment' : 'segment selected'} onClick={() => setPriorityFilters({ grouped: false })} aria-pressed={!filters.grouped}>One list</button>
    </div>
    <select className="loot-filter-select" aria-label="Filter by encounter" value={filters.encounter} onChange={(event) => setPriorityFilters({ encounter: event.target.value })}>
      <option value="">All encounters</option>
      {options.encounters.map((encounter) => <option key={encounter} value={encounter}>{encounter}</option>)}
    </select>
    <select className="loot-filter-select" aria-label="Filter by player" value={filters.player} onChange={(event) => setPriorityFilters({ player: event.target.value })}>
      <option value="">All players</option>
      {options.players.map((name) => <option key={name} value={name}>{name}</option>)}
    </select>
    <select className="loot-filter-select" aria-label="Filter by class" value={filters.className} onChange={(event) => setPriorityFilters({ className: event.target.value })}>
      <option value="">All classes</option>
      {options.classes.map((className) => <option key={className} value={className}>{className}</option>)}
    </select>
    {filtersActive(filters) && <button className="loot-filter-clear" onClick={clearPriorityFilters}>Clear filters</button>}
  </div>
}
