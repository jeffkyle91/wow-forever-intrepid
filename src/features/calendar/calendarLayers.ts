// What the Guild Calendar shows (UX-007): raids, unavailable dates ("absences"), both or neither.
// Pure, so Node can test it; the choice itself is kept by useCalendarLayers.ts.

export type CalendarLayer = 'raids' | 'absences'
export type CalendarLayers = Record<CalendarLayer, boolean>

export const ALL_LAYERS: CalendarLayers = { raids: true, absences: true }

// Always a new array, so the caller may sort it.
export function raidsOnDay<T extends { date: string }>(raids: readonly T[], dayKey: string, layers: CalendarLayers): T[] {
  return layers.raids ? raids.filter((raid) => raid.date === dayKey) : []
}

export function absencesOnDay<T extends { startDate: string; endDate: string }>(entries: readonly T[], dayKey: string, layers: CalendarLayers): T[] {
  return layers.absences ? entries.filter((entry) => entry.startDate <= dayKey && entry.endDate >= dayKey) : []
}

// A link to a raid has to show that raid, so it turns Raids back on and leaves Absences as they were.
export const withRaidsShown = (layers: CalendarLayers): CalendarLayers => layers.raids ? layers : { ...layers, raids: true }

export const hiddenNote = (layers: CalendarLayers) => layers.raids || layers.absences ? undefined : 'Raids and absences are hidden. Turn one on under Show to see it.'
