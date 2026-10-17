import type { TabContext } from '../../shared/tabs/types'
import { AwardHistory } from './AwardHistory'
import { classLookup } from './classLookup'
import { filterAwards } from './filters'

export function HistoryTab({ ctx }: { ctx: TabContext }) {
  return <AwardHistory awards={filterAwards(ctx.data.awards, ctx.query)} classOf={classLookup(ctx.data.roster)} />
}
