import { guildArt } from '../../shared/art'
import type { TabDefinition } from '../../shared/tabs/types'
import { LeadershipTab } from './LeadershipTab'

export const leadershipTab = {
  id: 'leadership',
  label: 'Leadership Overview',
  art: guildArt,
  guildLeaderOnly: true,
  hint: 'Raid responses, character requests and live team coverage.',
  panelTitle: 'Leadership Overview',
  navCount: (ctx) => ctx.data.characterRequests.filter((request) => request.status === 'pending').length,
  recordCount: () => 'Guild Leader management',
  footer: () => <>Readiness and sign-ups are planning tools, not confirmed attendance.</>,
  Content: LeadershipTab,
} as const satisfies TabDefinition
