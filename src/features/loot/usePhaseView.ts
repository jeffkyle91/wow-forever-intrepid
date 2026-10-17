import { phaseNoOf, viewedPhase } from '../../shared/game/phases'
import type { TabContext } from '../../shared/tabs/types'
import { usePriorityFilters } from './priorityFilters'

// The phase the Loot priorities tab is looking at, and its priorities. A past phase is a read-only record. The next phase can be prepared
// by leaders (and only they are offered it) but nothing can be awarded from it yet.
export function usePhaseView(ctx: TabContext) {
  const { phase } = usePriorityFilters()
  const leader = ctx.identity.canEditRaidData
  const view = viewedPhase(ctx.data.settings, phase, leader)
  return {
    view,
    priorities: ctx.data.allPriorities.filter((priority) => phaseNoOf(priority) === view.no),
    canEdit: leader && view.kind !== 'past',
    canAward: leader && view.kind === 'current',
  }
}
