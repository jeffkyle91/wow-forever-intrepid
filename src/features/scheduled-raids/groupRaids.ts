// Scheduled Raids lists the raids still to come as rows and keeps the rest (started, cancelled, or with no saved start time) in a group under them (RAID-016). Pure, so Node
// tests it, and it takes only what it reads of a raid so it needs nothing from the app's data layer.

/** The element id of a raid's row, which is where the tab scrolls to when the navigation names the raid. */
export const raidRowId = (raidId: string) => `raid-row-${raidId}`

type RaidTiming = { status?: string; startsAt?: { toMillis(): number } }

/**
 * A raid is closed, and sits in the older group, when it is cancelled, has no saved start time, or has started. This is the test the tab has always used for read-only,
 * and the one the server applies to sign-ups and planning (`open` in functions/raidPlanning.js).
 */
export function isClosedRaid(raid: RaidTiming, now: number): boolean {
  return raid.status === 'cancelled' || !raid.startsAt || raid.startsAt.toMillis() <= now
}

/** The raids still to come in the order given (the caller sorts oldest first), and the older ones, most recent first. */
export function groupScheduledRaids<T extends RaidTiming>(sorted: readonly T[], now: number): { upcoming: T[]; older: T[] } {
  const upcoming: T[] = []
  const older: T[] = []
  for (const raid of sorted) (isClosedRaid(raid, now) ? older : upcoming).push(raid)
  return { upcoming, older: older.reverse() }
}

/** When the next raid still to come starts, so the tab can show it as started at that moment without polling every second. */
export function nextStartAfter(raids: readonly RaidTiming[], now: number): number | undefined {
  let next: number | undefined
  for (const raid of raids) {
    if (raid.status === 'cancelled' || !raid.startsAt) continue
    const start = raid.startsAt.toMillis()
    if (start > now && (next === undefined || start < next)) next = start
  }
  return next
}
