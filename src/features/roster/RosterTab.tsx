import { namedTeams } from '../../shared/game/teams'
import type { TabContext } from '../../shared/tabs/types'
import { useHideAlts } from './altVisibility'
import { filterRoster } from './filter'
import { PlayerModal } from './PlayerModal'
import { sortRoster } from './sort'
import { useSortChoice } from './sortChoice'
import { RosterTable } from './RosterTable'
import './Roster.css'

export function RosterTab({ ctx }: { ctx: TabContext }) {
  const { roster, assignments } = ctx.data
  const hideAlts = useHideAlts()
  const sort = useSortChoice()
  const teams = namedTeams(ctx.data.settings.teamNames)
  return <RosterTable teams={teams} players={sortRoster(filterRoster(roster, ctx.query, hideAlts), sort.key, sort.direction, (playerId) => assignments[playerId], teams.map((team) => team.key))} allPlayers={roster} hideAlts={hideAlts} keepAltsTogether={sort.keepAltsTogether} assignments={assignments} canEdit={ctx.identity.canEditRoster} comments={ctx.data.comments} showLeadership={ctx.identity.canEditRaidData && ctx.data.comments.leadership !== null} onEdit={(player) => ctx.openModal(({ close, live }) => <PlayerModal existing={player} close={close} live={live} />)} />
}
