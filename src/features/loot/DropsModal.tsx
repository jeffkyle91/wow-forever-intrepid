import { useState } from 'react'
import type { PhaseOption } from '../../shared/game/phases'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'
import { DropsBrowser } from './DropsBrowser'
import { TablesEditor } from './TablesEditor'

// `phase` is the phase of the priority list the dialog works on (the one being looked at when it was opened). Guild and Raid Leaders can switch
// to the editor for the drop lists themselves and back. The browser stays mounted while they edit, so what they had ticked is still there, and the
// phase picked is kept here so the editor opens on the phase Browse drops was showing.
export function DropsModal({ close, live, phase }: { close: () => void; live: TabContext; phase: PhaseOption }) {
  const [editing, setEditing] = useState(false)
  const [phaseNo, setPhaseNo] = useState(phase.no)
  return <Modal title={editing ? 'Edit the drop lists' : 'Loot drops'} onClose={close}>
    {live.identity.canEditRaidData && <div className="drops-mode"><button type="button" className="button button-secondary" onClick={() => setEditing(!editing)}>{editing ? 'Back to Browse drops' : 'Edit the drop lists'}</button></div>}
    <div hidden={editing}><DropsBrowser live={live} phaseNo={phaseNo} onPhaseNo={setPhaseNo} /></div>
    {editing && <TablesEditor live={live} phaseNo={phaseNo} onPhaseNo={setPhaseNo} />}
  </Modal>
}
