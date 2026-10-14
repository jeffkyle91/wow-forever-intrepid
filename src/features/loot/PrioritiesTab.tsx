import { saveGuildRecord, type PriorityRecord as LootPriority } from '../../guildApi'
import type { TabContext } from '../../shared/tabs/types'
import { AwardModal } from './AwardModal'
import { filterPriorities } from './filters'
import { PriorityList } from './PriorityList'
import { PriorityModal } from './PriorityModal'

export function PrioritiesTab({ ctx }: { ctx: TabContext }) {
  const { priorities, awards } = ctx.data
  const { busy, setMutationError } = ctx.feedback

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
      const { id, ...record } = { ...priority, rankedPlayers }
      await saveGuildRecord('lootPriorities', id, record)
      setMutationError('')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Could not reorder loot candidates.')
    }
  }

  return <PriorityList priorities={filterPriorities(priorities, ctx.query)} awards={awards} canEdit={ctx.identity.canEditRaidData} busy={busy} onEdit={(priority) => ctx.openModal(({ close, live }) => <PriorityModal existing={priority} close={close} live={live} />)} onAward={openAward} onMoveCandidate={moveCandidate} />
}
