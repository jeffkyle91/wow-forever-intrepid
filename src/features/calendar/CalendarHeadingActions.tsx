import { Plus } from 'lucide-react'
import { localDateKey } from '../../shared/lib/dates'
import type { TabContext } from '../../shared/tabs/types'
import { RaidModal } from './RaidModal'

export function CalendarHeadingActions({ ctx }: { ctx: TabContext }) {
  function openRaidModal() {
    const date = localDateKey(new Date())
    ctx.openModal(({ close, live }) => <RaidModal date={date} close={close} live={live} />)
  }

  return <>{ctx.identity.canEditRaidData && <button className="button button-primary" onClick={openRaidModal}><Plus size={16} /> Add Raid</button>}</>
}
