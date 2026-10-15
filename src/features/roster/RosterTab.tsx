import { namedTeams } from '../../shared/game/teams'
import type { TabContext } from '../../shared/tabs/types'
import { useHideAlts } from './altVisibility'
import { filterRoster } from './filter'
import { PlayerModal } from './PlayerModal'
import { RosterTable } from './RosterTable'

export function RosterTab({ ctx }: { ctx: TabContext }) {
  const { roster, assignments } = ctx.data
  const hideAlts = useHideAlts()
  return <RosterTable teams={namedTeams(ctx.data.settings.teamNames)} players={filterRoster(roster, ctx.query, hideAlts)} allPlayers={roster} hideAlts={hideAlts} assignments={assignments} canEdit={ctx.identity.canEditRoster} onEdit={(player) => ctx.openModal(({ close, live }) => <PlayerModal existing={player} close={close} live={live} />)} />
}
