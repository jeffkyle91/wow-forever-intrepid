import { Fragment } from 'react'
import type { ModalRenderer, TabContext } from '../shared/tabs/types'

export type ActiveModal = { render: ModalRenderer; key: number }

// Renders the one open modal after <main>. The key changes on every open so state inside
// a modal (form fields, hooks) never leaks from one open to the next. `live` is rebuilt
// on every shell render, so a modal always sees the current busy flag and identity.
export function ModalHost({ modal, close, live }: { modal: ActiveModal | null; close: () => void; live: TabContext }) {
  if (!modal) return null
  return <Fragment key={modal.key}>{modal.render({ close, live })}</Fragment>
}
