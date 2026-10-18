import type { TabContext } from '../../shared/tabs/types'
import { makeWho } from '../../shared/game/candidates'
import { visiblePriorities } from './filters'
import { filtersActive, usePriorityFilters } from './priorityFilters'
import { usePhaseView } from './usePhaseView'
import { useSlotOf } from './useSlotOf'

// Said only when a search or a filter narrows the list ("Showing 2 of 4"): the whole list needs no count of its own.
export function PrioritiesFooter({ ctx }: { ctx: TabContext }) {
  const filters = usePriorityFilters()
  const slotOf = useSlotOf()
  const { priorities, lookup } = usePhaseView(ctx)
  if (!ctx.query.trim() && !filtersActive(filters)) return null
  return <>Showing <strong>{visiblePriorities(priorities, ctx.data.awards, ctx.query, filters, slotOf, lookup, makeWho(ctx.data.roster)).length}</strong> of <strong>{priorities.length}</strong></>
}
