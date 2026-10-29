// The All raids list of Raid History (RAID-019): every raid the guild has, from the raids already loaded (no read of its own), each with its category, newest first, with
// a category and a month filter and "Show more". Pure, so Node tests it, and it takes only what it reads of a raid.
import { RAID_CATEGORIES, raidCategory, type RaidCategory } from '../../shared/raids/raidCategory.ts'

type ListedRaid = { id: string; date: string; time?: string; status?: string; startsAt?: { toMillis(): number } }
export type CategorizedRaid<T> = { raid: T; category: RaidCategory }
export type CategoryFilter = RaidCategory | 'all'

/** How many raids the list shows at first, and how many more each "Show more" adds. */
export const PAGE_SIZE = 25

/**
 * Every raid with its category, newest first: by date, then start time, then id (a raid's date and time are its Eastern start, and the rules keep its saved start
 * in step with them). `timeOf` is the raid's time with the app's default for a raid saved without one.
 */
export function categorizedRaids<T extends ListedRaid>(raids: readonly T[], now: number, timeOf: (raid: T) => string): CategorizedRaid<T>[] {
  return [...raids]
    .sort((a, b) => b.date.localeCompare(a.date) || timeOf(b).localeCompare(timeOf(a)) || b.id.localeCompare(a.id))
    .map((raid) => ({ raid, category: raidCategory(raid, now) }))
}

/** The month of a raid's date, as "YYYY-MM". */
export const monthOf = (date: string) => date.slice(0, 7)

/** The months that have raids, newest first, for the Month filter. */
export function raidMonths(raids: readonly Pick<ListedRaid, 'date'>[]): string[] {
  return [...new Set(raids.map((raid) => monthOf(raid.date)).filter((month) => /^\d{4}-\d{2}$/.test(month)))].sort().reverse()
}

/** "2026-12" as "December 2026" (the month is a plain date part, so it never shifts with the viewer's time zone). */
export function monthLabel(month: string): string {
  const day = new Date(`${month}-15T12:00:00Z`)
  return Number.isNaN(day.getTime()) ? month : day.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** The raids of one month ('' for every month). */
export function inMonth<T extends Pick<ListedRaid, 'date'>>(entries: readonly CategorizedRaid<T>[], month: string): CategorizedRaid<T>[] {
  return month ? entries.filter(({ raid }) => monthOf(raid.date) === month) : [...entries]
}

/** The raids of one category ('all' for every category). */
export function inCategory<T>(entries: readonly CategorizedRaid<T>[], category: CategoryFilter): CategorizedRaid<T>[] {
  return category === 'all' ? [...entries] : entries.filter((entry) => entry.category === category)
}

/** How many raids each category has, and all of them, for the counts beside the category filter. */
export function categoryCounts(entries: readonly CategorizedRaid<unknown>[]): Record<CategoryFilter, number> {
  const counts = Object.fromEntries([['all', entries.length], ...RAID_CATEGORIES.map((category) => [category, 0])]) as Record<CategoryFilter, number>
  for (const { category } of entries) counts[category] += 1
  return counts
}
