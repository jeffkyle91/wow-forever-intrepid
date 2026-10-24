// The day a Log entry belongs to, so the Log can be filtered by date like a loot council's history. Pure, no imports, so Node tests it.
//
// An award's day is the **raid night** it was awarded on (`awardedAt`), not the moment it was typed in: an award entered the next morning, or imported later from the addon,
// belongs to the night it dropped. Every other entry (a priority, a phase, a drop list) is dated by when it was made, in the viewer's own time.

type EntryLike = { targetType: string; targetId: string; at: Date | null; before: Record<string, unknown>; after: Record<string, unknown> }

const text = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined)

/** A moment as the viewer's calendar day, YYYY-MM-DD. */
export function localDay(at: Date): string {
  return [at.getFullYear(), String(at.getMonth() + 1).padStart(2, '0'), String(at.getDate()).padStart(2, '0')].join('-')
}

/** The day of an entry: the raid night for an award (as it stands now, else as the entry says), the day it was made for anything else; none when neither is known. */
export function entryDate(entry: EntryLike, awardDate: (awardId: string) => string | undefined): string | undefined {
  if (entry.targetType === 'award') {
    const night = awardDate(entry.targetId) ?? text(entry.after.awardedAt) ?? text(entry.before.awardedAt)
    if (night) return night
  }
  return entry.at ? localDay(entry.at) : undefined
}

/** The days to offer in a dropdown: each day once with how many entries are on it, newest first. The day chosen is always included. */
export function dateChoices(days: readonly (string | undefined)[], chosen: string): { date: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const day of days) if (day) counts.set(day, (counts.get(day) ?? 0) + 1)
  if (chosen && !counts.has(chosen)) counts.set(chosen, 0)
  return [...counts].map(([date, count]) => ({ date, count })).sort((a, b) => b.date.localeCompare(a.date))
}
