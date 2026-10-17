import type { TabContext } from '../../shared/tabs/types'
import { setHideAlts, useHideAlts } from './altVisibility'

export function TeamsToolbar({ ctx }: { ctx: TabContext }) {
  const { raidView, setRaidView } = ctx.shell
  const hideAlts = useHideAlts()
  return <><div className="segmented-control" aria-label="Raid team size">{([10, 20, 40] as const).map((size) => <button key={size} className={raidView === size ? 'segment selected' : 'segment'} onClick={() => setRaidView(size)} aria-pressed={raidView === size}>{size}<span>player</span></button>)}</div>
  <div className="segmented-control" role="group" aria-label="Available characters">
    <button className={hideAlts ? 'segment' : 'segment selected'} onClick={() => setHideAlts(false)} aria-pressed={!hideAlts}>All characters</button>
    <button className={hideAlts ? 'segment selected' : 'segment'} onClick={() => setHideAlts(true)} aria-pressed={hideAlts}>Hide alts</button>
  </div></>
}
