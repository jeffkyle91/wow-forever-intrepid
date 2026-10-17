import { useSyncExternalStore } from 'react'

let showComments = false
const listeners = new Set<() => void>()

export function setShowComments(next: boolean) {
  showComments = next
  listeners.forEach((listener) => listener())
}

export function useShowComments() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => showComments)
}
