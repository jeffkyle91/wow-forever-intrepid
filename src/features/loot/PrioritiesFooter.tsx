import type { TabContext } from '../../shared/tabs/types'
import { visiblePriorities } from './filters'
import { usePriorityFilters } from './priorityFilters'

export function PrioritiesFooter({ ctx }: { ctx: TabContext }) {
  const filters = usePriorityFilters()
  return <>Showing <strong>{visiblePriorities(ctx.data.priorities, ctx.data.awards, ctx.data.roster, ctx.query, filters).length}</strong> of <strong>{ctx.data.priorities.length}</strong></>
}
