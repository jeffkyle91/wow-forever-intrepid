import { Search } from 'lucide-react'
import type { TabContext } from '../shared/tabs/types'
import type { TabEntry } from './tabs'

export function WorkspacePanel({ tab, ctx, setQuery, error, notice }: { tab: TabEntry; ctx: TabContext; setQuery: (query: string) => void; error: string; notice: string }) {
  return (
    <section className="workspace-panel">
      <div className="panel-toolbar"><div className="panel-heading"><h2>{tab.panelTitle}</h2><span className="record-count">{tab.recordCount(ctx)}</span></div><div className="toolbar-controls">
        {tab.Toolbar && <tab.Toolbar ctx={ctx} />}
        {tab.search && <label className="search-field" htmlFor="table-search"><Search size={15} /><input id="table-search" value={ctx.query} onChange={(event) => setQuery(event.target.value)} placeholder={tab.search.placeholder} /><kbd>Ctrl K</kbd></label>}
      </div></div>
      <tab.Content key={tab.id} ctx={ctx} />
      {error && <p className="app-error" role="alert">{error}</p>}
      {notice && <p className="app-notice" role="status">{notice}</p>}
      <footer className="panel-footer"><span>{tab.footer(ctx)}</span><span className="footer-right"><span className="save-indicator" /> Shared with guild</span></footer>
    </section>
  )
}
