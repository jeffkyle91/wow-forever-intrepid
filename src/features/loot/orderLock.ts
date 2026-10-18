import { useSyncExternalStore } from 'react'

// The order of a priority's candidates is locked, so that moving a line takes a decision: a leader clicks the lock on that item to unlock it, and
// the arrows appear. It is a guard against clicking around the page, kept for the page session only (every item is locked again when the page loads
// and nothing is stored), and each item has its own lock.
let unlocked: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

/** The set with `id` taken out when it was in, put in when it was not. */
export function withToggled(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}

export function toggleOrderLock(id: string) {
  unlocked = withToggled(unlocked, id)
  listeners.forEach((listener) => listener())
}

/** The ids of the priorities whose order is unlocked right now. */
export function useUnlockedOrders() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => unlocked)
}
