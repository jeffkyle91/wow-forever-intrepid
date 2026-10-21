import type { TabContext } from '../../shared/tabs/types'
import { AuditInfoTab } from './AuditInfoTab'
import './RaidHistory.css'

export function RaidHistoryTab({ ctx }: { ctx: TabContext }) {
  return <div className="raid-history-feature">
    <nav className="raid-history-subtabs" role="tablist" aria-label="Raid history sections">
      <button type="button" className="raid-history-subtab selected" role="tab" id="raid-history-audit-tab" aria-selected="true" aria-controls="raid-history-audit-panel">Audit Info</button>
    </nav>
    <section id="raid-history-audit-panel" role="tabpanel" aria-labelledby="raid-history-audit-tab">
      <AuditInfoTab ctx={ctx} />
    </section>
  </div>
}
