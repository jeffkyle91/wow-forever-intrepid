import { Modal } from '../../shared/ui/Modal'
import { DropsBrowser } from './DropsBrowser'

export function DropsModal({ close }: { close: () => void }) {
  return <Modal title="Loot drops" onClose={close}><DropsBrowser /></Modal>
}
