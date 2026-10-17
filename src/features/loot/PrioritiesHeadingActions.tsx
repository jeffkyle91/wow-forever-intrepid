import { BookOpen, Plus } from 'lucide-react'
import type { TabContext } from '../../shared/tabs/types'
import { DropsModal } from './DropsModal'
import { PriorityModal } from './PriorityModal'

export function PrioritiesHeadingActions({ ctx }: { ctx: TabContext }) {
  return <>{ctx.identity.canEditRaidData && <button className="button button-primary" onClick={() => ctx.openModal(({ close, live }) => <PriorityModal close={close} live={live} />)}><Plus size={16} /> Add priority</button>}<button className="button button-secondary" onClick={() => ctx.openModal(({ close }) => <DropsModal close={close} />)}><BookOpen size={16} /> Browse drops</button></>
}
