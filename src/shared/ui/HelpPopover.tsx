import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { popoverPosition } from './popoverPosition'
import './HelpPopover.css'

export function HelpPopover({ label, trigger, children, triggerClassName = 'help-popover-trigger' }: {
  label: string
  trigger: ReactNode
  children: ReactNode
  triggerClassName?: string
}) {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useLayoutEffect(() => {
    if (!open) return
    const element = panel.current
    const position = () => {
      if (!element || !button.current) return
      const viewport = window.visualViewport
      element.style.maxWidth = `${Math.max(1, (viewport?.width ?? window.innerWidth) - 24)}px`
      element.style.maxHeight = `${Math.max(1, Math.min(300, (viewport?.height ?? window.innerHeight) - 24))}px`
      const next = popoverPosition(button.current.getBoundingClientRect(), element.getBoundingClientRect(), {
        left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight,
      })
      element.style.left = `${next.left}px`
      element.style.top = `${next.top}px`
    }
    position()
    const observer = new ResizeObserver(position)
    if (element) observer.observe(element)
    const dismiss = () => { if (element?.matches(':popover-open')) element.hidePopover() }
    const outside = (event: Event) => {
      if (event.target instanceof Node && !element?.contains(event.target) && !button.current?.contains(event.target)) dismiss()
    }
    const scroll = (event: Event) => {
      // Reading a long panel must not dismiss it; scrolling its surroundings must.
      if (!(event.target instanceof Node) || !element?.contains(event.target)) dismiss()
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismiss()
        button.current?.focus({ preventScroll: true })
      }
    }
    document.addEventListener('scroll', scroll, true)
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('click', outside, true)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', keydown, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', scroll)
    window.visualViewport?.addEventListener('resize', dismiss)
    window.visualViewport?.addEventListener('scroll', dismiss)
    return () => {
      observer.disconnect()
      document.removeEventListener('scroll', scroll, true)
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('click', outside, true)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', keydown, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', scroll)
      window.visualViewport?.removeEventListener('resize', dismiss)
      window.visualViewport?.removeEventListener('scroll', dismiss)
    }
  }, [open])

  return <>
    <button ref={button} type="button" className={triggerClassName} popoverTarget={id}
      aria-label={label} aria-expanded={open} aria-controls={id}>{trigger}</button>
    <div ref={panel} id={id} popover="auto" className="help-popover" role="region" aria-label={label} tabIndex={0}
      onToggle={(event) => setOpen(event.newState === 'open')}>
      {children}
    </div>
  </>
}
