import { Search } from 'lucide-react'

export function EmptyRow({ colSpan, title, detail }: { colSpan: number; title: string; detail: string }) {
  return <tr><td colSpan={colSpan}><div className="empty-state"><span className="empty-icon"><Search size={20} /></span><strong>{title}</strong><p>{detail}</p></div></td></tr>
}
