import { useSyncExternalStore } from 'react'
import type { SortDirection, SortKey } from './sort'

// The sort choice is shared by the toolbar and the table, which are separate components. It lasts for the page session and is not
// saved anywhere, like Hide alts. keepAltsTogether is on by default: each alt sits under its main, as the roster always has.
type Choice = { key: SortKey; direction: SortDirection; keepAltsTogether: boolean }
let choice: Choice = { key: 'default', direction: 'asc', keepAltsTogether: true }
const listeners = new Set<() => void>()
const publish = (next: Choice) => { choice = next; listeners.forEach((listener) => listener()) }

export const setSortKey = (key: SortKey) => publish({ ...choice, key })
export const setSortDirection = (direction: SortDirection) => publish({ ...choice, direction })
export const setKeepAltsTogether = (keepAltsTogether: boolean) => publish({ ...choice, keepAltsTogether })

export function useSortChoice() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => choice)
}
