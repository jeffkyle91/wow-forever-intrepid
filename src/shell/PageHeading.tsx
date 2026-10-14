import type { TabContext } from '../shared/tabs/types'
import type { TabEntry } from './tabs'

export function PageHeading({ tab, ctx }: { tab: TabEntry; ctx: TabContext }) {
  return (
    <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> GUILD OPERATIONS</div><h1>{tab.label}</h1><p>{tab.hint}</p></div><div className="heading-actions">
      {tab.HeadingActions && <tab.HeadingActions ctx={ctx} />}
    </div></section>
  )
}
