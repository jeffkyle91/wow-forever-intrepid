import { useSyncExternalStore } from 'react'

// The loot filters are shared by the toolbar, the list and the footer, which are separate components.
// They live for the page session only and are not saved anywhere.
// `encounter` is a scope (see encounterOptions in groupPriorities.ts); `slot` is one of slotChoices, or empty for all.
// `phase` is the phase being looked at (see shared/game/phases.ts); null means the current phase, so the list follows when a new phase starts.
export type PriorityFilters = { hideCompleted: boolean; encounter: string; player: string; slot: string; grouped: boolean; phase: number | null }

// `grouped` and `phase` are choices of view, not filters: Clear filters leaves them as they are, and they do not count as an active filter.
export const noPriorityFilters: PriorityFilters = { hideCompleted: false, encounter: '', player: '', slot: '', grouped: true, phase: null }

let filters = noPriorityFilters
const listeners = new Set<() => void>()

export function setPriorityFilters(change: Partial<PriorityFilters>) {
  filters = { ...filters, ...change }
  listeners.forEach((listener) => listener())
}

export function clearPriorityFilters() {
  filters = { ...noPriorityFilters, grouped: filters.grouped, phase: filters.phase }
  listeners.forEach((listener) => listener())
}

export function usePriorityFilters() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => filters)
}

export function filtersActive(value: PriorityFilters) {
  return value.hideCompleted || !!value.encounter || !!value.player || !!value.slot
}
