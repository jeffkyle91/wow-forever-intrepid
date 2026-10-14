import { calendarArt } from '../../shared/art'
import type { TabDefinition } from '../../shared/tabs/types'
import { CalendarHeadingActions } from './CalendarHeadingActions'
import { CalendarTab } from './CalendarTab'

export const calendarTab = {
  id: 'afk',
  label: 'Raid Calendar',
  art: calendarArt,
  hint: 'Share dates when you are unavailable to raid.',
  panelTitle: 'Raid Calendar',
  navCount: (ctx) => ctx.data.raids.length + ctx.data.afkEntries.length,
  recordCount: (ctx) => `${ctx.data.raids.length} raids · ${ctx.data.afkEntries.length} date ranges`,
  footer: (ctx) => <><strong>{ctx.data.raids.length}</strong> raids · <strong>{ctx.data.afkEntries.length}</strong> shared date ranges</>,
  HeadingActions: CalendarHeadingActions,
  Content: CalendarTab,
} as const satisfies TabDefinition
