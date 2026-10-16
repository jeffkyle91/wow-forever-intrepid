const eastern = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

// Test both Eastern offsets. A spring-forward gap is invalid; a repeated fall hour uses its first occurrence.
export function raidStartDate(date: string, time: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('Enter a valid raid date and start time.')
  }
  const wallTime = Date.parse(`${date}T${time}:00Z`)
  if (!Number.isFinite(wallTime) || new Date(wallTime).toISOString().slice(0, 10) !== date) {
    throw new Error('Enter a valid raid date.')
  }
  for (const hours of [4, 5]) {
    const instant = new Date(wallTime + hours * 60 * 60 * 1000)
    const parts = Object.fromEntries(eastern.formatToParts(instant).map(({ type, value }) => [type, value]))
    if (`${parts.year}-${parts.month}-${parts.day}` === date && `${parts.hour}:${parts.minute}` === time) return instant
  }
  throw new Error('That Eastern start time does not exist because of daylight saving time. Choose another time.')
}
