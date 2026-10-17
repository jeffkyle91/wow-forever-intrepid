import { setHideAlts, useHideAlts } from './altVisibility'
import { setShowComments, useShowComments } from './commentVisibility'
import { SortMenu } from './SortMenu'

export function RosterToolbar() {
  const hideAlts = useHideAlts()
  const showComments = useShowComments()
  return <>
    <div className="segmented-control" role="group" aria-label="Roster view">
    <button className={`roster-view-toggle ${hideAlts ? 'segment' : 'segment selected'}`} onClick={() => setHideAlts(false)} aria-pressed={!hideAlts}>All characters</button>
    <button className={`roster-view-toggle ${hideAlts ? 'segment selected' : 'segment'}`} onClick={() => setHideAlts(true)} aria-pressed={hideAlts}>Hide alts</button>
    </div>
    <button type="button" className={`roster-view-toggle roster-comments-toggle ${showComments ? 'segment selected' : 'segment'}`} aria-pressed={showComments} onClick={() => setShowComments(!showComments)}>Show Comments</button>
    <SortMenu hideAlts={hideAlts} />
  </>
}
