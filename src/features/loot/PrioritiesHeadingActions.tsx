import { Plus } from 'lucide-react'
import type { TabContext } from '../../shared/tabs/types'
import { PriorityModal } from './PriorityModal'

export function PrioritiesHeadingActions({ ctx }: { ctx: TabContext }) {
  return <>{ctx.identity.canEditRaidData && <button className="button button-primary" onClick={() => ctx.openModal(({ close, live }) => <PriorityModal close={close} live={live} />)}><Plus size={16} /> Add priority</button>}</>
}
