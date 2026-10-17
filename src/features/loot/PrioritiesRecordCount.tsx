import type { TabContext } from '../../shared/tabs/types'
import { usePhaseView } from './usePhaseView'

// The count under the panel title is for the phase being looked at (the sidebar count stays the current phase's).
export function PrioritiesRecordCount({ ctx }: { ctx: TabContext }) {
  return <>{usePhaseView(ctx).priorities.length} records</>
}
