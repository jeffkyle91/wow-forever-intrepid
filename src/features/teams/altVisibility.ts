import { useSyncExternalStore } from 'react'

// Whether the Raid teams page hides alts from the lists of characters still to be placed. The toolbar and the page are separate
// components, so the choice lives here. It lasts for the page session and is not saved anywhere.
let hideAlts = false
const listeners = new Set<() => void>()

export function setHideAlts(next: boolean) {
  hideAlts = next
  listeners.forEach((listener) => listener())
}

export function useHideAlts() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => hideAlts)
}
