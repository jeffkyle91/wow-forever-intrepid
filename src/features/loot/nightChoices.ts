// The choices of the "Copy for addon" dialog (ADDON-002, issue #193) that need no React: which raids the picker offers, which one it starts on, and the
// count line. Pure, with no imports, so Node tests it.

/**
 * The producer named in every night string (`by`, docs/spec/exchange-v0.md section 5.1). The app has no version or release constant (package.json
 * says 0.0.0 and the build defines none), so it names the web app only, never a person.
 */
export const NIGHT_BY = 'RaidDesk/web'

// What the picker reads of a raid. RaidRecord (guildApi.ts) satisfies it.
type Raid = { id: string; date: string; time?: string; status?: string }

// A raid saved without a start time starts at the usual time: DEFAULT_RAID_TIME in guildApi.ts, which Node cannot import (it loads Firebase).
const USUAL_TIME = '21:00'

/** The day before a `YYYY-MM-DD` date, as `YYYY-MM-DD`. */
export function dayBefore(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
}

/**
 * The raids the picker offers, and the one it starts on. `today` is the viewer's own date (`localDateKey`); a raid's date is compared with it as it is.
 * - Offered: every raid that is not cancelled, from the day before today on, by date and then start time. The day before is there for a raid that runs
 *   past midnight, and for a leader whose date is already ahead of the raid's.
 * - Starts on: the first raid of today; when there is none, the first one after today; else no raid (`''`).
 */
export function nightRaidChoices<T extends Raid>(raids: readonly T[], today: string): { raids: T[]; defaultId: string } {
  const from = dayBefore(today)
  const offered = raids
    .filter((raid) => raid.status !== 'cancelled' && raid.date >= from)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? USUAL_TIME).localeCompare(b.time ?? USUAL_TIME))
  const chosen = offered.find((raid) => raid.date === today) ?? offered.find((raid) => raid.date > today)
  return { raids: offered, defaultId: chosen?.id ?? '' }
}

/** The raid the picker shows: the leader's pick (`''` is no raid), else the default. A pick that is no longer offered (cancelled meanwhile) is no raid. */
export function pickedRaid<T extends Raid>(choices: { raids: readonly T[]; defaultId: string }, picked: string | null): T | undefined {
  const id = picked ?? choices.defaultId
  return id === '' ? undefined : choices.raids.find((raid) => raid.id === id)
}

const counted = (count: number, one: string, many: string) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`

/** "58 players · 87 priorities · 14 bosses · 12,345 characters": what the string holds, and its length (the game takes 100,000). */
export function nightCounts(model: { roster: readonly unknown[]; priorities: readonly unknown[]; bosses?: readonly unknown[] }, length: number): string {
  return [
    counted(model.roster.length, 'player', 'players'),
    counted(model.priorities.length, 'priority', 'priorities'),
    counted(model.bosses?.length ?? 0, 'boss', 'bosses'),
    counted(length, 'character', 'characters'),
  ].join(' · ')
}
