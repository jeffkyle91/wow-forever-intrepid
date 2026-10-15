import { membersArt } from '../../shared/art'
import type { TabDefinition } from '../../shared/tabs/types'
import { RosterFooter } from './RosterFooter'
import { RosterHeadingActions } from './RosterHeadingActions'
import { RosterTab } from './RosterTab'
import { RosterToolbar } from './RosterToolbar'

export const rosterTab = {
  id: 'roster',
  label: 'Guild roster',
  art: membersArt,
  hint: 'Every member of the guild, whether assigned to a raid team or not.',
  panelTitle: 'Guild roster',
  search: { placeholder: 'Find a member...' },
  navCount: (ctx) => ctx.data.roster.length,
  recordCount: (ctx) => `${ctx.data.roster.length} members`,
  footer: (ctx) => <RosterFooter ctx={ctx} />,
  HeadingActions: RosterHeadingActions,
  Toolbar: RosterToolbar,
  Content: RosterTab,
} as const satisfies TabDefinition
