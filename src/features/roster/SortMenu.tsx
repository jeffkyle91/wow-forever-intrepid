import { useEffect, useId, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown } from 'lucide-react'
import { sortKeys, type SortDirection } from './sort'
import { setKeepAltsTogether, setSortDirection, setSortKey, useSortChoice } from './sortChoice'

const directions: { id: SortDirection; label: string }[] = [{ id: 'asc', label: 'Ascending' }, { id: 'desc', label: 'Descending' }]
const panelWidth = 240

// A button that opens the sort choices in a popover: which column, which way, and whether alts stay under their mains. The popover
// closes on a click outside it or Escape (the browser does that), and here also when focus moves to another field or the page scrolls
// or resizes, because it is placed from the button's position when it opens.
export function SortMenu({ hideAlts }: { hideAlts: boolean }) {
  const sort = useSortChoice()
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: 320 })
  const sorted = sort.key !== 'default'

  useEffect(() => {
    if (!open) return
    const close = (event: Event) => { if (!(event.target instanceof Node && panel.current?.contains(event.target))) panel.current?.hidePopover() }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [open])

  return <>
    <button type="button" ref={trigger} className="roster-sort-trigger" popoverTarget={id} aria-haspopup="dialog" aria-expanded={open}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const top = Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 180))
        setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - panelWidth - 12)), top, maxHeight: window.innerHeight - top - 12 })
      }}>
      <ArrowUpDown size={13} aria-hidden="true" />
      <span>{sorted ? `Sort: ${sortKeys.find((option) => option.id === sort.key)?.label}` : 'Sort'}</span>
      {sorted && (sort.direction === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)}
      {sorted && <span className="visually-hidden">{sort.direction === 'asc' ? ', ascending' : ', descending'}</span>}
      <ChevronDown size={12} aria-hidden="true" />
    </button>
    <div id={id} ref={panel} popover="auto" role="dialog" aria-label="Sort the roster" className="roster-sort-panel" style={{ ...position, width: `min(${panelWidth}px, calc(100vw - 24px))` }}
      onBlur={(event) => {
        // Tabbing out of the last control would otherwise leave the menu open over the next field. Focus going to nothing (a click on the
        // panel's own padding) or to the button (which toggles it) must not close it.
        const next = event.relatedTarget
        if (next instanceof Node && !event.currentTarget.contains(next) && next !== trigger.current) event.currentTarget.hidePopover()
      }}
      onToggle={(event) => {
        setOpen(event.newState === 'open')
        if (event.newState === 'open') panel.current?.querySelector<HTMLInputElement>('input:checked')?.focus({ preventScroll: true })
      }}>
      <fieldset>
        <legend>Sort by</legend>
        {sortKeys.map((option) => <label key={option.id}><input type="radio" name={`${id}-key`} checked={sort.key === option.id} onChange={() => setSortKey(option.id)} />{option.label}</label>)}
      </fieldset>
      <fieldset disabled={!sorted}>
        <legend>Order</legend>
        {directions.map((option) => <label key={option.id}><input type="radio" name={`${id}-direction`} checked={sort.direction === option.id} onChange={() => setSortDirection(option.id)} />{option.label}</label>)}
      </fieldset>
      <label className="roster-sort-alts"><input type="checkbox" checked={sort.keepAltsTogether} disabled={hideAlts} onChange={(event) => setKeepAltsTogether(event.target.checked)} />Keep alts under their mains</label>
      {hideAlts && <small>Alts are hidden, so this has no effect.</small>}
    </div>
  </>
}
