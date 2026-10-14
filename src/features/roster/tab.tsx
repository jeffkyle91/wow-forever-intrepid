import { membersArt } from '../../shared/art'
import type { TabDefinition } from '../../shared/tabs/types'
import { filterRoster } from './filter'
import { RosterHeadingActions } from './RosterHeadingActions'
import { RosterTab } from './RosterTab'

export const rosterTab = {
  id: 'roster',
  label: 'Guild roster',
  art: membersArt,
  hint: 'Every member of the guild, whether assigned to a raid team or not.',
  panelTitle: 'Guild roster',
  search: { placeholder: 'Find a member...' },
  navCount: (ctx) => ctx.data.roster.length,
  recordCount: (ctx) => `${ctx.data.roster.length} members`,
  footer: (ctx) => <>Showing <strong>{filterRoster(ctx.data.roster, ctx.query).length}</strong> of <strong>{ctx.data.roster.length}</strong></>,
  HeadingActions: RosterHeadingActions,
  Content: RosterTab,
} as const satisfies TabDefinition
