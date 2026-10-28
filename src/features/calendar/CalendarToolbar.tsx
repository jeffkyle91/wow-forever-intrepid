import { Check, Plus } from 'lucide-react'
import { localDateKey } from '../../shared/lib/dates'
import type { TabContext } from '../../shared/tabs/types'
import type { CalendarLayer } from './calendarLayers'
import { RaidModal } from './RaidModal'
import { toggleCalendarLayer, useCalendarLayers } from './useCalendarLayers'
import './CalendarLayers.css'

const LAYER_BUTTONS: readonly { layer: CalendarLayer; label: string }[] = [{ layer: 'raids', label: 'Raids' }, { layer: 'absences', label: 'Absences' }]

export function CalendarToolbar({ ctx }: { ctx: TabContext }) {
  const layers = useCalendarLayers()

  function openRaidModal() {
    const date = localDateKey(new Date())
    ctx.openModal(({ close, live }) => <RaidModal date={date} close={close} live={live} />)
  }

  return <>
    <div className="calendar-layers" role="group" aria-labelledby="calendar-layers-label" title="Changes only what you see on this page">
      <span className="calendar-layers-label" id="calendar-layers-label">Show:</span>
      <div className="segmented-control">{LAYER_BUTTONS.map(({ layer, label }) => <button type="button" key={layer} className={layers[layer] ? 'segment selected' : 'segment'} aria-pressed={layers[layer]} onClick={() => toggleCalendarLayer(layer)}><Check className="calendar-layer-check" size={11} aria-hidden="true" />{label}</button>)}</div>
    </div>
    {ctx.identity.canEditRaidData && <button className="button button-primary" onClick={openRaidModal}><Plus size={16} /> Add Raid</button>}
  </>
}
