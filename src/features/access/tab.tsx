import { accessArt } from '../../shared/art'
import type { TabDefinition } from '../../shared/tabs/types'
import { AccessTab } from './AccessTab'

export const accessTab = {
  id: 'access',
  label: 'Member access',
  art: accessArt,
  hint: 'Review join requests and manage guild roles.',
  panelTitle: 'Guild members and requests',
  guildLeaderOnly: true,
  navCount: (ctx) => ctx.data.joinRequests.length,
  recordCount: (ctx) => `${ctx.data.members.length} members · ${ctx.data.joinRequests.length} requests`,
  footer: (ctx) => <><strong>{ctx.data.members.length}</strong> active guild accounts</>,
  Content: AccessTab,
} as const satisfies TabDefinition
