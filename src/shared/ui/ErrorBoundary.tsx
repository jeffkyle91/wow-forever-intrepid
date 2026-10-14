import { Component, type ReactNode } from 'react'
import { Modal } from './Modal'

type Props = { children: ReactNode; resetKey?: string | number } & ({ kind: 'app' | 'panel' } | { kind: 'dialog'; onClose: () => void })

// Renders its children exactly as they are (no element of its own) until one of them throws while
// rendering, then replaces them with a plain message and a Reload button. It does not catch errors in
// event handlers or async code. Once it has caught an error it stays up until `resetKey` changes: the
// shell uses the tab id for the panel and the open dialog's key for the dialog host, so switching tabs
// or opening another dialog starts clean. (A `key` would also reset it, but it would remount the whole
// panel on every tab switch; resetKey leaves a healthy panel mounted.) Three kinds only differ in where
// the message is drawn: the whole page, the workspace panel, or a dialog (which also gets a Close
// button). The fallback reuses existing classes, so it adds no CSS.
export class ErrorBoundary extends Component<Props, { failed: boolean; resetKey: Props['resetKey'] }> {
  state = { failed: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: Props, state: { resetKey: Props['resetKey'] }) {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey }
  }

  render() {
    if (!this.state.failed) return this.props.children
    const props = this.props
    const reload = <button className="button button-primary" onClick={() => window.location.reload()}>Reload</button>

    if (props.kind === 'dialog') {
      return <Modal title="This dialog could not be shown" onClose={props.onClose}>
        <div className="modal-form">
          <p role="alert">Something went wrong while drawing it. Close it and try again, or reload the page.</p>
          <div className="modal-actions"><button className="button button-secondary" onClick={props.onClose}>Close</button>{reload}</div>
        </div>
      </Modal>
    }

    const message = props.kind === 'app'
      ? <><strong>The raid desk hit a problem</strong><p>Something went wrong while drawing this page. Reload to try again.</p></>
      : <><strong>This tab could not be shown</strong><p>The rest of the desk is still working. Switch to another tab, or reload the page to try again.</p></>
    const panel = <section className="workspace-panel"><div className="empty-state" role="alert">{message}{reload}</div></section>
    return props.kind === 'app' ? <div className="page-wrap">{panel}</div> : panel
  }
}
