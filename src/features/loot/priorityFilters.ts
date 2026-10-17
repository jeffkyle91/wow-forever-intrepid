import { useSyncExternalStore } from 'react'

// The loot filters are shared by the toolbar, the list and the footer, which are separate components.
// They live for the page session only and are not saved anywhere.
export type PriorityFilters = { hideCompleted: boolean; needsPlayers: boolean; encounter: string; player: string; className: string; grouped: boolean }

// `grouped` is a choice of layout, not a filter: Clear filters leaves it as it is, and it does not count as an active filter.
export const noPriorityFilters: PriorityFilters = { hideCompleted: false, needsPlayers: false, encounter: '', player: '', className: '', grouped: true }

let filters = noPriorityFilters
const listeners = new Set<() => void>()

export function setPriorityFilters(change: Partial<PriorityFilters>) {
  filters = { ...filters, ...change }
  listeners.forEach((listener) => listener())
}

export function clearPriorityFilters() {
  filters = { ...noPriorityFilters, grouped: filters.grouped }
  listeners.forEach((listener) => listener())
}

export function usePriorityFilters() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => filters)
}

export function filtersActive(value: PriorityFilters) {
  return value.hideCompleted || value.needsPlayers || !!value.encounter || !!value.player || !!value.className
}
