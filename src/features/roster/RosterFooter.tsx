import type { TabContext } from '../../shared/tabs/types'
import { useHideAlts } from './altVisibility'
import { filterRoster } from './filter'

export function RosterFooter({ ctx }: { ctx: TabContext }) {
  const hideAlts = useHideAlts()
  return <>Showing <strong>{filterRoster(ctx.data.roster, ctx.query, hideAlts).length}</strong> of <strong>{ctx.data.roster.length}</strong></>
}
