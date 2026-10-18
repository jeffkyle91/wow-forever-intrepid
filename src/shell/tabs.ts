import { accessTab } from '../features/access/tab'
import { calendarTab } from '../features/calendar/tab'
import { dashboardTab } from '../features/dashboard/tab'
import { leadershipTab } from '../features/leadership/tab'
import { prioritiesTab } from '../features/loot/tab'
import { rosterTab } from '../features/roster/tab'
import { settingsTab } from '../features/settings/tab'
import { teamsTab } from '../features/teams/tab'
import type { GuildRole } from '../security'
import type { TabDefinition } from '../shared/tabs/types'

// The tab registry. The order here is the order in the sidebar. To add a tab, add a feature folder
// with a tab.tsx, plus one import above and one line below. Declare each tab with
// `as const satisfies TabDefinition` (do not annotate it) so its id stays a literal.
const tabs = [
  dashboardTab,
  rosterTab,
  teamsTab,
  calendarTab,
  prioritiesTab,
  leadershipTab,
  accessTab,
  settingsTab,
] as const satisfies readonly TabDefinition[]

export type TabId = (typeof tabs)[number]['id']

// Fails to compile if a tab was declared without `as const satisfies` (its id would widen to string).
export const tabIdsAreLiteral: string extends TabId ? never : true = true

// The shell reads this widened view so the optional fields (guildLeaderOnly, search, Toolbar,
// HeadingActions, navCount) are typed while `id` stays the literal union.
export const tabList: readonly (TabDefinition & { readonly id: TabId })[] = tabs
export type TabEntry = (typeof tabList)[number]

// The tab shown on load.
export const DEFAULT_TAB_ID: TabId = 'dashboard'
// Where a tab the current role may not see sends the user.
export const FALLBACK_TAB_ID: TabId = 'roster'

export function isTabVisible(tab: TabEntry, effectiveRole: GuildRole | null) {
  return !tab.guildLeaderOnly || effectiveRole === 'Guild Leader'
}
