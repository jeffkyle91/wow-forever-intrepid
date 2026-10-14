import { lootArt, trophyArt } from '../../shared/art'
import type { TabDefinition } from '../../shared/tabs/types'
import { filterAwards, filterPriorities } from './filters'
import { HistoryTab } from './HistoryTab'
import { PrioritiesHeadingActions } from './PrioritiesHeadingActions'
import { PrioritiesTab } from './PrioritiesTab'

export const prioritiesTab = {
  id: 'priorities',
  label: 'Loot priorities',
  art: lootArt,
  hint: 'Set council order before the next drop.',
  panelTitle: 'Upcoming loot',
  search: { placeholder: 'Find item or player...' },
  navCount: (ctx) => ctx.data.priorities.length,
  recordCount: (ctx) => `${ctx.data.priorities.length} records`,
  footer: (ctx) => <>Showing <strong>{filterPriorities(ctx.data.priorities, ctx.query).length}</strong> of <strong>{ctx.data.priorities.length}</strong></>,
  HeadingActions: PrioritiesHeadingActions,
  Content: PrioritiesTab,
} as const satisfies TabDefinition

export const historyTab = {
  id: 'history',
  label: 'Award history',
  art: trophyArt,
  hint: 'A permanent record of council decisions.',
  panelTitle: 'Recent awards',
  search: { placeholder: 'Find item or player...' },
  navCount: (ctx) => ctx.data.awards.length,
  recordCount: (ctx) => `${ctx.data.awards.length} records`,
  // Preserved quirk: both numbers are the filtered count, so the footer never shows the unfiltered total.
  footer: (ctx) => <>Showing <strong>{filterAwards(ctx.data.awards, ctx.query).length}</strong> of <strong>{filterAwards(ctx.data.awards, ctx.query).length}</strong></>,
  Content: HistoryTab,
} as const satisfies TabDefinition
