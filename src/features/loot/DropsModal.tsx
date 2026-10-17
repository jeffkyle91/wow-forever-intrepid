import type { PhaseOption } from '../../shared/game/phases'
import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'
import { DropsBrowser } from './DropsBrowser'

// `phase` is the phase of the priority list the dialog works on (the one being looked at when it was opened).
export function DropsModal({ close, live, phase }: { close: () => void; live: TabContext; phase: PhaseOption }) {
  return <Modal title="Loot drops" onClose={close}><DropsBrowser live={live} phase={phase} /></Modal>
}
