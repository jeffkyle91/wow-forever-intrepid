import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header className="modal-header"><div><span className="eyebrow"><span className="eyebrow-line" /> GUILD DESK</span><h2 id="modal-title">{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></header>{children}</section></div>
}
