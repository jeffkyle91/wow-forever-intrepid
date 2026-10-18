import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { ZONE_PALETTE, isHexColor } from '../game/zoneColors'
import './ColorSelect.css'

// A dropdown of colors: the palette in color order (each with its swatch and name) and "Other" for any color, typed as #rrggbb or picked with the browser's
// color picker. A native <select> cannot show a swatch beside each name, so this is a button that opens a list box: Enter, Space or the arrow keys open it,
// the arrows, Home and End move, Enter or Space choose, Escape closes; Other opens a small form (a color picker and the color as #rrggbb) that takes the keyboard.
// The list is placed on the screen (fixed) so no panel it sits in can cut it off, below the button or above it when there is more room there, and closes when the page scrolls. `onChange` is told the chosen color (lower case) and nothing else changes. While `disabled`
// the button looks and reads as disabled but stays focusable, so a keyboard user does not lose their place while a choice is being saved.
const OTHER = ZONE_PALETTE.length

export function ColorSelect({ value, onChange, disabled, label, noneLabel = 'Not chosen' }: { value: string | undefined; onChange: (color: string) => void; disabled?: boolean; label: string; noneLabel?: string }) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const hex = useRef<HTMLInputElement>(null)
  const current = value ? value.toLowerCase() : undefined
  const named = ZONE_PALETTE.findIndex((entry) => entry.color === current)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState(current ?? '#278794')
  const [place, setPlace] = useState<CSSProperties>({})
  const shown = named >= 0 ? ZONE_PALETTE[named].name : current ? `Other (${current})` : noneLabel
  const draftColor = draft.startsWith('#') ? draft : `#${draft}`
  const draftOk = isHexColor(draftColor)

  const close = (refocus: boolean) => { setOpen(false); setTyping(false); if (refocus) button.current?.focus() }
  const openList = () => {
    const box = button.current?.getBoundingClientRect()
    if (box) {
      const below = window.innerHeight - box.bottom - 12
      const above = box.top - 12
      const up = below < 320 && above > below
      const style: Record<string, string | number> = { position: 'fixed', left: Math.max(8, Math.min(box.left, window.innerWidth - 208)), minWidth: Math.max(box.width, 200), '--color-list-max': `${Math.max(160, Math.min(400, (up ? above : below) - 56))}px` }
      if (up) style.bottom = window.innerHeight - box.top + 4
      else style.top = box.bottom + 4
      setPlace(style as unknown as CSSProperties)
    }
    setActive(named >= 0 ? named : current ? OTHER : 0)
    setDraft(current ?? '#278794')
    setOpen(true)
  }
  useEffect(() => { if (open) (typing ? hex.current : list.current)?.focus() }, [open, typing])
  // The highlighted color stays in view when the arrow keys run past the end of the visible part of the list.
  useEffect(() => { if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' }) }, [open, active, id])
  // A click anywhere else closes the list.
  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) close(false) }
    // The page scrolling or resizing closes the list (it is placed on the screen); the list scrolling itself does not.
    const leave = (event: Event) => { if (event.type === 'scroll' && root.current?.contains(event.target as Node)) return; close(false) }
    document.addEventListener('mousedown', away)
    window.addEventListener('scroll', leave, true)
    window.addEventListener('resize', leave)
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('scroll', leave, true); window.removeEventListener('resize', leave) }
  }, [open])

  const choose = (index: number) => {
    if (index === OTHER) { setTyping(true); return }
    onChange(ZONE_PALETTE[index].color)
    close(true)
  }
  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); if (!disabled) openList() }
  }
  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const last = OTHER
    if (event.key === 'ArrowDown') setActive((index) => Math.min(last, index + 1))
    else if (event.key === 'ArrowUp') setActive((index) => Math.max(0, index - 1))
    else if (event.key === 'Home') setActive(0)
    else if (event.key === 'End') setActive(last)
    else if (event.key === 'Enter' || event.key === ' ') choose(active)
    else if (event.key === 'Escape') close(true)
    else if (event.key === 'Tab') close(false)
    else return
    event.preventDefault()
  }

  return <div className="color-select" ref={root}>
    <button ref={button} type="button" className="color-select-button" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} aria-label={`${label}: ${shown}`} aria-disabled={disabled || undefined}
      onClick={() => { if (disabled) return; if (open) close(false); else openList() }} onKeyDown={onButtonKey}>
      <span className="color-select-swatch" style={{ background: current ?? 'transparent' }} aria-hidden="true" />
      <span className="color-select-name">{shown}</span>
      <span className="color-select-chevron" aria-hidden="true">{'▾'}</span>
    </button>
    {open && <div className="color-select-popup" style={place}>
      <ul ref={list} id={`${id}-list`} role="listbox" aria-label={label} tabIndex={-1} aria-activedescendant={`${id}-${active}`} onKeyDown={onListKey}>
        {[...ZONE_PALETTE.map((entry) => ({ name: entry.name, color: entry.color as string })), { name: 'Other…', color: '' }].map((entry, index) => (
          <li key={entry.name} id={`${id}-${index}`} role="option" aria-selected={index === named || (index === OTHER && named < 0 && !!current)} className={index === active ? 'is-active' : undefined}
            onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>
            <span className="color-select-swatch" style={{ background: entry.color || 'transparent' }} aria-hidden="true" />
            <span>{entry.name}</span>
          </li>
        ))}
      </ul>
      {typing && <div className="color-select-other">
        <input type="color" value={draftOk ? draftColor : '#278794'} onChange={(event) => setDraft(event.target.value)} aria-label={`${label}: pick a color`} />
        <input ref={hex} type="text" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={7} spellCheck={false} aria-label={`${label}: color as #rrggbb`} aria-invalid={!draftOk}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (draftOk) { onChange(draftColor.toLowerCase()); close(true) } } else if (event.key === 'Escape') { event.preventDefault(); close(true) } }} />
        <button type="button" className="button button-secondary" disabled={!draftOk} onClick={() => { onChange(draftColor.toLowerCase()); close(true) }}>Use</button>
      </div>}
    </div>}
  </div>
}
