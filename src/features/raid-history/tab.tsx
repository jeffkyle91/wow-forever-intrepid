import { raidArt } from '../../shared/art'
import type { TabDefinition } from '../../shared/tabs/types'
import { RaidHistoryTab } from './RaidHistoryTab'

export const raidHistoryTab = {
  id: 'raid-history',
  label: 'Raid History',
  art: raidArt,
  hint: 'Read immutable snapshots of scheduled raid lineups and responses.',
  panelTitle: 'Audit Info',
  recordCount: () => null,
  footer: () => <>Starting snapshots show the scheduled plan and responses; they do not confirm attendance.</>,
  Content: RaidHistoryTab,
} as const satisfies TabDefinition
