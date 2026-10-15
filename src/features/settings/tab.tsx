import settingsArt from '../../../Art/icons-split/settings.png'
import type { TabDefinition } from '../../shared/tabs/types'
import { SettingsTab } from './SettingsTab'

export const settingsTab = {
  id: 'settings',
  label: 'Settings',
  art: settingsArt,
  hint: 'Change the phase, status and team names members see.',
  panelTitle: 'Guild settings',
  guildLeaderOnly: true,
  recordCount: () => 'Guild Leader only',
  footer: (ctx) => <>Council status: <strong>{ctx.data.settings.councilStatus === 'live' ? 'Live' : 'Deliberating'}</strong></>,
  Content: SettingsTab,
} as const satisfies TabDefinition
