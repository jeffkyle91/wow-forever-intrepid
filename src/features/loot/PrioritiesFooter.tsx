import { makeWho } from '../../shared/game/candidates'
import type { TabContext } from '../../shared/tabs/types'
import { visiblePriorities } from './filters'
import { usePriorityFilters } from './priorityFilters'
import { usePhaseView } from './usePhaseView'
import { useSlotOf } from './useSlotOf'

export function PrioritiesFooter({ ctx }: { ctx: TabContext }) {
  const filters = usePriorityFilters()
  const slotOf = useSlotOf()
  const { priorities, lookup } = usePhaseView(ctx)
  return <>Showing <strong>{visiblePriorities(priorities, ctx.data.awards, ctx.query, filters, slotOf, lookup, makeWho(ctx.data.roster)).length}</strong> of <strong>{priorities.length}</strong></>
}
