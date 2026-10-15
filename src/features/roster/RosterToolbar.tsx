import { setHideAlts, useHideAlts } from './altVisibility'

export function RosterToolbar() {
  const hideAlts = useHideAlts()
  return <div className="segmented-control" role="group" aria-label="Roster view">
    <button className={hideAlts ? 'segment' : 'segment selected'} onClick={() => setHideAlts(false)} aria-pressed={!hideAlts}>All characters</button>
    <button className={hideAlts ? 'segment selected' : 'segment'} onClick={() => setHideAlts(true)} aria-pressed={hideAlts}>Hide alts</button>
  </div>
}
