import type { TabContext } from '../../shared/tabs/types'
import { visiblePriorities } from './filters'
import { usePriorityFilters } from './priorityFilters'
import { useSlotOf } from './useSlotOf'

export function PrioritiesFooter({ ctx }: { ctx: TabContext }) {
  const filters = usePriorityFilters()
  const slotOf = useSlotOf()
  return <>Showing <strong>{visiblePriorities(ctx.data.priorities, ctx.data.awards, ctx.query, filters, slotOf).length}</strong> of <strong>{ctx.data.priorities.length}</strong></>
}
