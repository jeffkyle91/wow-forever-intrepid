import { useEffect } from 'react'
import { editPriority, type PriorityRecord as LootPriority } from '../../guildApi'
import { requestItem } from '../../shared/lib/itemInfo'
import type { TabContext } from '../../shared/tabs/types'
import { AwardModal } from './AwardModal'
import { classLookup } from './classLookup'
import { visiblePriorities } from './filters'
import { bossOrder } from './bossOrder'
import { PriorityList } from './PriorityList'
import { PriorityModal } from './PriorityModal'
import { usePriorityFilters } from './priorityFilters'
import { usePhaseView } from './usePhaseView'
import { useSlotOf } from './useSlotOf'

export function PrioritiesTab({ ctx }: { ctx: TabContext }) {
  const { awards, roster } = ctx.data
  const { busy, setMutationError } = ctx.feedback
  const filters = usePriorityFilters()
  const { view, priorities, canEdit, canAward, lookup } = usePhaseView(ctx)
  const slotOf = useSlotOf()
  // Look up every priority's item, not only the rows on screen, so that the slot filter can tell which ones match.
  useEffect(() => { priorities.forEach((priority) => { if (priority.itemId) requestItem(priority.itemId) }) }, [priorities])

  function openAward(priority: LootPriority) {
    const now = new Date()
    const localDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
    ctx.openModal(({ close, live }) => <AwardModal priority={priority} awardedAt={localDate} close={close} live={live} />)
  }

  async function moveCandidate(priority: LootPriority, index: number, direction: -1 | 1) {
    const rankedPlayers = [...priority.rankedPlayers]
    const target = index + direction
    if (target < 0 || target >= rankedPlayers.length) return
    ;[rankedPlayers[index], rankedPlayers[target]] = [rankedPlayers[target], rankedPlayers[index]]
    try {
      await editPriority(priority, { rankedPlayers }, { uid: ctx.identity.uid, displayName: ctx.identity.displayName }, 'reorder')
      setMutationError('')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not reorder loot candidates.')
    }
  }

  // What the person looking at a closed or upcoming phase needs to know.
  const notice = view.kind === 'past' ? `${view.name} is closed. This is a record of its lists: nothing here can be changed.`
    : view.kind === 'next' ? `${view.name} has not started. Only leaders see it. Prepare its lists here; nothing can be awarded until it starts.` : undefined

  return <PriorityList priorities={visiblePriorities(priorities, awards, ctx.query, filters, slotOf, lookup)} lookup={lookup} grouped={filters.grouped} bossOrder={bossOrder} awards={awards} classOf={classLookup(roster)} canEdit={canEdit} canAward={canAward} notice={notice} busy={busy} onEdit={(priority) => ctx.openModal(({ close, live }) => <PriorityModal existing={priority} phaseNo={view.no} close={close} live={live} />)} onAward={openAward} onMoveCandidate={moveCandidate} />
}
