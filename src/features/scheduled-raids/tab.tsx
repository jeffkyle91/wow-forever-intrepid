import { raidArt } from '../../shared/art'
import type { TabDefinition } from '../../shared/tabs/types'
import { ScheduledRaidsTab } from './ScheduledRaidsTab'

export const scheduledRaidsTab = {
  id: 'scheduled-raids',
  label: 'Scheduled Raids',
  art: raidArt,
  hint: 'View scheduled lineups and responses. Guild and Raid Leaders manage positions and review warnings.',
  panelTitle: 'Scheduled raids',
  recordCount: () => null, // the list changes as raids start and leave, which the heading would only learn on its next render
  footer: () => <>Scheduled positions and responses are planning tools, not confirmed attendance.</>,
  Content: ScheduledRaidsTab,
} as const satisfies TabDefinition
