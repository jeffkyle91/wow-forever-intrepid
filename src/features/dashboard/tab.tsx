import shieldArt from '../../../Art/icons-split/shield.png'
import type { TabDefinition } from '../../shared/tabs/types'
import { findMyCharacters } from './myCharacters'
import { DashboardHeadingActions } from './DashboardHeadingActions'
import { DashboardTab } from './DashboardTab'

export const dashboardTab = {
  id: 'dashboard',
  label: 'My dashboard',
  art: shieldArt,
  hint: 'Your characters, raid team, loot priorities and upcoming raids.',
  panelTitle: 'My dashboard',
  recordCount: (ctx) => {
    const count = findMyCharacters(ctx.data.roster, ctx.identity.uid).characters.length
    return count ? `${count} ${count === 1 ? 'character' : 'characters'}` : 'No linked character'
  },
  footer: (ctx) => findMyCharacters(ctx.data.roster, ctx.identity.uid).linked ? <>Showing the characters linked to <strong>{ctx.identity.displayName || 'your account'}</strong></> : <>A Guild Leader links your character in Member Access</>,
  HeadingActions: DashboardHeadingActions,
  Content: DashboardTab,
} as const satisfies TabDefinition
