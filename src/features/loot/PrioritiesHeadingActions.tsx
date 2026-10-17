import { BookOpen, History, Layers, Plus } from 'lucide-react'
import type { TabContext } from '../../shared/tabs/types'
import { AuditLogModal } from './AuditLogModal'
import { DropsModal } from './DropsModal'
import { PhasesModal } from './PhasesModal'
import { PriorityModal } from './PriorityModal'
import { usePhaseView } from './usePhaseView'

export function PrioritiesHeadingActions({ ctx }: { ctx: TabContext }) {
  const { view, canEdit } = usePhaseView(ctx)
  return <>{canEdit && <button className="button button-primary" onClick={() => ctx.openModal(({ close, live }) => <PriorityModal phaseNo={view.no} close={close} live={live} />)}><Plus size={16} /> Add priority</button>}<button className="button button-secondary" onClick={() => ctx.openModal(({ close, live }) => <DropsModal phase={view} close={close} live={live} />)}><BookOpen size={16} /> Browse drops</button><button className="button button-secondary" onClick={() => ctx.openModal(({ close, live }) => <AuditLogModal close={close} live={live} />)}><History size={16} /> Change log</button>{ctx.identity.canEditRoster && <button className="button button-secondary" onClick={() => ctx.openModal(({ close, live }) => <PhasesModal close={close} live={live} />)}><Layers size={16} /> Phases</button>}</>
}
