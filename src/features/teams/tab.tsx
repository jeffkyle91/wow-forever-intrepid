import { raidArt } from '../../shared/art'
import type { TabContext, TabDefinition } from '../../shared/tabs/types'
import { TeamsTab } from './TeamsTab'
import { TeamsToolbar } from './TeamsToolbar'

const assignedCount = (ctx: TabContext) => ctx.data.roster.filter((player) => ctx.data.assignments[player.id]).length

export const teamsTab = {
  id: 'teams',
  label: 'Raid teams',
  art: raidArt,
  hint: 'Manage four 10-player groups; larger teams are combined automatically.',
  panelTitle: 'Team composition',
  navCount: assignedCount,
  recordCount: (ctx) => ctx.shell.raidView === 10 ? '4 teams' : ctx.shell.raidView === 20 ? '2 teams' : '1 team',
  footer: (ctx) => <><strong>{assignedCount(ctx)}</strong> of <strong>{ctx.data.roster.length}</strong> guild members assigned</>,
  Toolbar: TeamsToolbar,
  Content: TeamsTab,
} as const satisfies TabDefinition
