import type { TabContext } from '../../shared/tabs/types'

export function TeamsToolbar({ ctx }: { ctx: TabContext }) {
  const { raidView, setRaidView } = ctx.shell
  return <div className="segmented-control" aria-label="Raid team size">{([10, 20, 40] as const).map((size) => <button key={size} className={raidView === size ? 'segment selected' : 'segment'} onClick={() => setRaidView(size)} aria-pressed={raidView === size}>{size}<span>player</span></button>)}</div>
}
