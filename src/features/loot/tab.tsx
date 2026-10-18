import { lootArt } from '../../shared/art'
import type { TabDefinition } from '../../shared/tabs/types'
import { PrioritiesFooter } from './PrioritiesFooter'
import { PrioritiesHeadingActions } from './PrioritiesHeadingActions'
import { PrioritiesRecordCount } from './PrioritiesRecordCount'
import { PrioritiesTab } from './PrioritiesTab'
import { PrioritiesToolbar } from './PrioritiesToolbar'

export const prioritiesTab = {
  id: 'priorities',
  label: 'Loot priorities',
  art: lootArt,
  hint: 'Set council order before the next drop.',
  panelTitle: 'Upcoming loot',
  search: { placeholder: 'Find item or player...' },
  navCount: (ctx) => ctx.data.priorities.length,
  recordCount: (ctx) => <PrioritiesRecordCount ctx={ctx} />,
  footer: (ctx) => <PrioritiesFooter ctx={ctx} />,
  HeadingActions: PrioritiesHeadingActions,
  Toolbar: PrioritiesToolbar,
  Content: PrioritiesTab,
} as const satisfies TabDefinition
