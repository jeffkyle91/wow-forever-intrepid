import { useSyncExternalStore } from 'react'
import { ALL_LAYERS, withRaidsShown, type CalendarLayer, type CalendarLayers } from './calendarLayers'

// The choice is read by the toolbar (the toggles) and the grid, which are separate components.
// It lives for the page session only and is not saved anywhere, so a reload shows both again.
let layers: CalendarLayers = ALL_LAYERS
const listeners = new Set<() => void>()

function set(next: CalendarLayers) {
  if (next === layers) return
  layers = next
  listeners.forEach((listener) => listener())
}

export const toggleCalendarLayer = (layer: CalendarLayer) => set({ ...layers, [layer]: !layers[layer] })
export const showCalendarRaids = () => set(withRaidsShown(layers))

export function useCalendarLayers() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => layers)
}
