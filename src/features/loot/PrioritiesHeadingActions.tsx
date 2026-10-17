import { BookOpen, Plus } from 'lucide-react'
import type { TabContext } from '../../shared/tabs/types'
import { DropsModal } from './DropsModal'
import { PriorityModal } from './PriorityModal'
import { usePhaseView } from './usePhaseView'

export function PrioritiesHeadingActions({ ctx }: { ctx: TabContext }) {
  const { view, canEdit } = usePhaseView(ctx)
  return <>{canEdit && <button className="button button-primary" onClick={() => ctx.openModal(({ close, live }) => <PriorityModal phaseNo={view.no} close={close} live={live} />)}><Plus size={16} /> Add priority</button>}<button className="button button-secondary" onClick={() => ctx.openModal(({ close, live }) => <DropsModal phase={view} close={close} live={live} />)}><BookOpen size={16} /> Browse drops</button></>
}
