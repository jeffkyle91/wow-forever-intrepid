import type { TabContext } from '../../shared/tabs/types'
import { filterRoster } from './filter'
import { PlayerModal } from './PlayerModal'
import { RosterTable } from './RosterTable'

export function RosterTab({ ctx }: { ctx: TabContext }) {
  const { roster, assignments } = ctx.data
  return <RosterTable players={filterRoster(roster, ctx.query)} assignments={assignments} canEdit={ctx.identity.canEditRoster} onEdit={(player) => ctx.openModal(({ close, live }) => <PlayerModal existing={player} close={close} live={live} />)} />
}
