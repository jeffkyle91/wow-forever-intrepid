import { accessArt } from '../../shared/art'
import type { TabDefinition } from '../../shared/tabs/types'
import { AccessTab } from './AccessTab'

export const accessTab = {
  id: 'access',
  label: 'Member access',
  art: accessArt,
  hint: 'Review join requests, manage guild roles and remove or restore access.',
  panelTitle: 'Guild members and requests',
  guildLeaderOnly: true,
  navCount: (ctx) => ctx.data.joinRequests.length,
  recordCount: (ctx) => `${ctx.data.members.length} members · ${ctx.data.joinRequests.length} requests`,
  footer: (ctx) => <><strong>{ctx.data.members.filter((member) => member.role !== 'Removed').length}</strong> active guild accounts · <strong>{ctx.data.members.filter((member) => member.role === 'Removed').length}</strong> removed</>,
  Content: AccessTab,
} as const satisfies TabDefinition
