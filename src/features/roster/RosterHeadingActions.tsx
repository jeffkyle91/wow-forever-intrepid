import { Plus } from 'lucide-react'
import type { TabContext } from '../../shared/tabs/types'
import { PlayerModal } from './PlayerModal'

export function RosterHeadingActions({ ctx }: { ctx: TabContext }) {
  return <>{ctx.identity.canEditRoster && <button className="button button-primary" onClick={() => ctx.openModal(({ close, live }) => <PlayerModal close={close} live={live} />)}><Plus size={16} /> Add member</button>}</>
}
