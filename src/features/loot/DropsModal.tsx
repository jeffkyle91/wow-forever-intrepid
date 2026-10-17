import type { TabContext } from '../../shared/tabs/types'
import { Modal } from '../../shared/ui/Modal'
import { DropsBrowser } from './DropsBrowser'

export function DropsModal({ close, live }: { close: () => void; live: TabContext }) {
  return <Modal title="Loot drops" onClose={close}><DropsBrowser live={live} /></Modal>
}
