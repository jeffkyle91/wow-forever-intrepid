import { createElement, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { itemIconUrl, type TooltipElement, type TooltipNode } from '../game/itemTooltip'
import { retryItem, useItemInfo } from '../lib/itemInfo'
import './ItemTooltip.css'

// Renders the tree that sanitizeTooltipHtml() produced as ordinary elements. Class names get a prefix so that none can match a
// class the app itself styles.
function renderNodes(nodes: TooltipNode[]): ReactNode[] {
  return nodes.map((node, index) => (typeof node === 'string' ? node : renderElement(node, index)))
}
function renderElement(element: TooltipElement, key: number): ReactNode {
  const classes = [...(element.className?.split(' ') ?? []).map((name) => `tt-${name}`), ...(element.wide ? ['tt-wide'] : [])].join(' ')
  return createElement(element.tag, { key, className: classes || undefined }, ...(element.tag === 'br' ? [] : renderNodes(element.children)))
}

const panelWidth = 320

// An item's name (colored by quality, with its icon) that opens the full Wowhead tooltip on click, tap or Enter, and also when a mouse
// rests on it. Hover is only a convenience for mouse users: touch and keyboard have no hover, so click, tap and Enter always work. A
// tooltip opened by hover closes when the mouse leaves (the mouse may move onto the tooltip without it closing); clicking while it is
// open by hover keeps it open until Escape, a click elsewhere or another click on the item. Name, icon and tooltip are read live by
// item id; until then, or if that fails, the fallback name or the id is shown.
export function ItemTooltip({ itemId, fallbackName }: { itemId: number; fallbackName?: string }) {
  const state = useItemInfo(itemId)
  const panelId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const openedByHover = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: 400 })
  const info = state?.status === 'ready' ? state.info : undefined
  const name = info?.name ?? fallbackName ?? `Item ${itemId}`

  const stopTimer = () => { window.clearTimeout(timer.current); timer.current = undefined }
  useEffect(() => stopTimer, [])

  // Places the panel under the item, kept inside the window.
  function place(button: HTMLElement) {
    const rect = button.getBoundingClientRect()
    const top = Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 200))
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - panelWidth - 12)), top, maxHeight: window.innerHeight - top - 12 })
  }
  // A mouse resting on the item opens the tooltip after a short pause; leaving it closes it after a short pause, which the mouse
  // entering the tooltip cancels. Only a mouse does this: touch and pen have no hover.
  const hoverStart = (event: ReactPointerEvent) => {
    if (event.pointerType !== 'mouse') return
    stopTimer()
    timer.current = window.setTimeout(() => {
      if (!trigger.current || !panel.current || panel.current.matches(':popover-open')) return
      flushSync(() => place(trigger.current as HTMLElement))
      panel.current.showPopover()
      openedByHover.current = true
    }, 150)
  }
  const hoverEnd = (event: ReactPointerEvent) => {
    if (event.pointerType !== 'mouse') return
    stopTimer()
    timer.current = window.setTimeout(() => { if (openedByHover.current) panel.current?.hidePopover() }, 150)
  }
  const hoverKeep = (event: ReactPointerEvent) => { if (event.pointerType === 'mouse') stopTimer() }

  // The panel is placed from the button when it opens, so it closes when the page scrolls or resizes instead of drifting away.
  useEffect(() => {
    if (!open) return
    const close = (event: Event) => { if (!(event.target instanceof Node && panel.current?.contains(event.target))) panel.current?.hidePopover() }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [open])

  return <span className="item-tt">
    <button type="button" ref={trigger} className={`item-tt-trigger item-tt-quality-${info?.quality ?? 'unknown'}`} popoverTarget={panelId}
      onPointerEnter={hoverStart} onPointerLeave={hoverEnd}
      onClick={(event) => {
        // A click while the tooltip is open by hover keeps it open (the browser would close it); the next click closes it.
        if (openedByHover.current) { event.preventDefault(); openedByHover.current = false; return }
        place(event.currentTarget)
      }}>
      {info?.icon
        ? <img className="item-tt-icon" src={itemIconUrl(info.icon)} alt="" width={20} height={20} loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.visibility = 'hidden' }} />
        : <span className="item-tt-icon item-tt-icon-empty" aria-hidden="true" />}
      <span className="item-tt-name">{name}</span>
    </button>
    <div id={panelId} ref={panel} popover="auto" role="note" aria-label={`${name}, item details`} className="item-tt-panel" style={{ ...position, width: `min(${panelWidth}px, calc(100vw - 24px))` }}
      onPointerEnter={hoverKeep} onPointerLeave={hoverEnd}
      onToggle={(event) => { setOpen(event.newState === 'open'); if (event.newState !== 'open') { openedByHover.current = false; stopTimer() } }}>
      {info
        ? <div className="item-tt-body">{renderNodes(info.tooltip)}</div>
        : state?.status === 'error'
          ? <p className="item-tt-note">{state.message} Item id {itemId}. <button type="button" className="item-tt-retry" onClick={() => retryItem(itemId)}>Try again</button></p>
          : <p className="item-tt-note" role="status">Loading item {itemId}...</p>}
    </div>
  </span>
}
