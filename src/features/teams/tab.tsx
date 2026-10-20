import { raidArt } from '../../shared/art'
import type { TabContext, TabDefinition } from '../../shared/tabs/types'
import { TeamsTab } from './TeamsTab'
import { TeamsToolbar } from './TeamsToolbar'
import { standingAssignments } from '../../shared/game/teams'

const assignedCount = (ctx: TabContext) => ctx.data.roster.filter((player) => standingAssignments(ctx.data, ctx.shell.raidView)[player.id]).length

export const teamsTab = {
  id: 'teams',
  label: 'Raid teams',
  art: raidArt,
  hint: 'Manage independent 10-, 20- and 40-player standing teams. Scheduled raids copy these lineups once.',
  panelTitle: 'Team composition',
  navCount: assignedCount,
  recordCount: (ctx) => ctx.shell.raidView === 10 ? '4 teams' : ctx.shell.raidView === 20 ? '2 teams' : '1 team',
  footer: (ctx) => <><strong>{assignedCount(ctx)}</strong> of <strong>{ctx.data.roster.length}</strong> characters assigned at {ctx.shell.raidView}-player size</>,
  Toolbar: TeamsToolbar,
  Content: TeamsTab,
} as const satisfies TabDefinition
