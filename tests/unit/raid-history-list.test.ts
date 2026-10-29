// The All raids list of Raid History (features/raid-history/raidList.ts, RAID-019): newest first, each with its category, filtered by category and month.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { categorizedRaids, categoryCounts, inCategory, inMonth, monthLabel, monthOf, PAGE_SIZE, raidMonths } from '../../src/features/raid-history/raidList.ts'

const NOW = Date.parse('2026-12-10T12:00:00Z') // 7:00 AM Eastern, December 10
const HOUR = 3_600_000
type Raid = { id: string; date: string; time?: string; status?: string; startsAt?: { toMillis(): number } }
const raid = (id: string, date: string, time: string | undefined, startOffsetHours: number | null, status?: string): Raid => ({
  id, date, ...(time ? { time } : {}), ...(startOffsetHours === null ? {} : { startsAt: { toMillis: () => NOW + startOffsetHours * HOUR } }), ...(status ? { status } : {}),
})
const timeOf = (entry: Raid) => entry.time ?? '21:00'

const raids: Raid[] = [
  raid('old-legacy', '2026-10-02', undefined, null),
  raid('nov-held', '2026-11-20', '21:00', -20 * 24),
  raid('nov-cancelled', '2026-11-21', '21:00', -19 * 24, 'cancelled'),
  raid('dec-early', '2026-12-10', '05:00', -2),
  raid('dec-marked', '2026-12-10', '03:00', -4, 'complete'),
  raid('dec-tonight', '2026-12-10', '21:00', 14),
  raid('dec-tonight-b', '2026-12-10', '21:00', 14),
  raid('dec-called-off', '2026-12-12', '20:00', 61, 'cancelled'),
  raid('jan-legacy', '2027-01-05', undefined, null),
]

describe('every raid', () => {
  const listed = categorizedRaids(raids, NOW, timeOf)

  test('is listed once, newest first: by date, then start time, then id', () => {
    assert.deepEqual(listed.map(({ raid: entry }) => entry.id), [
      'jan-legacy', 'dec-called-off', 'dec-tonight-b', 'dec-tonight', 'dec-early', 'dec-marked', 'nov-cancelled', 'nov-held', 'old-legacy',
    ])
  })

  test('with its category', () => {
    assert.deepEqual(Object.fromEntries(listed.map(({ raid: entry, category }) => [entry.id, category])), {
      'jan-legacy': 'scheduled',
      'dec-called-off': 'cancelled',
      'dec-tonight-b': 'scheduled',
      'dec-tonight': 'scheduled',
      'dec-early': 'in-progress',
      'dec-marked': 'complete',
      'nov-cancelled': 'cancelled',
      'nov-held': 'complete',
      'old-legacy': 'complete',
    })
  })

  test('a raid saved without a time sorts by the default start time', () => {
    const sameDay = [raid('evening', '2026-12-01', '22:00', -200), raid('no-time', '2026-12-01', undefined, -201), raid('morning', '2026-12-01', '09:00', -212)]
    assert.deepEqual(categorizedRaids(sameDay, NOW, timeOf).map(({ raid: entry }) => entry.id), ['evening', 'no-time', 'morning'])
  })

  test('does not change the list it was given', () => {
    const copy = [...raids]
    categorizedRaids(raids, NOW, timeOf)
    assert.deepEqual(raids, copy)
  })

  test('an empty guild has an empty list', () => {
    assert.deepEqual(categorizedRaids([], NOW, timeOf), [])
  })
})

describe('the filters', () => {
  const listed = categorizedRaids(raids, NOW, timeOf)

  test('by category keep the order', () => {
    assert.deepEqual(inCategory(listed, 'cancelled').map(({ raid: entry }) => entry.id), ['dec-called-off', 'nov-cancelled'])
    assert.deepEqual(inCategory(listed, 'complete').map(({ raid: entry }) => entry.id), ['dec-marked', 'nov-held', 'old-legacy'])
    assert.deepEqual(inCategory(listed, 'in-progress').map(({ raid: entry }) => entry.id), ['dec-early'])
    assert.equal(inCategory(listed, 'all').length, raids.length)
  })

  test('by month take the raid date as written', () => {
    assert.deepEqual(inMonth(listed, '2026-11').map(({ raid: entry }) => entry.id), ['nov-cancelled', 'nov-held'])
    assert.deepEqual(inMonth(listed, '2026-12').length, 5)
    assert.deepEqual(inMonth(listed, '2025-01'), [])
    assert.equal(inMonth(listed, '').length, raids.length)
  })

  test('combine, and the counts are those of the month picked', () => {
    const december = inMonth(listed, '2026-12')
    assert.deepEqual(categoryCounts(december), { all: 5, scheduled: 2, 'in-progress': 1, complete: 1, cancelled: 1 })
    assert.deepEqual(inCategory(december, 'scheduled').map(({ raid: entry }) => entry.id), ['dec-tonight-b', 'dec-tonight'])
    assert.deepEqual(categoryCounts(listed), { all: 9, scheduled: 3, 'in-progress': 1, complete: 3, cancelled: 2 })
    assert.deepEqual(categoryCounts([]), { all: 0, scheduled: 0, 'in-progress': 0, complete: 0, cancelled: 0 })
  })
})

describe('the months', () => {
  test('are the months that have raids, newest first, once each', () => {
    assert.deepEqual(raidMonths(raids), ['2027-01', '2026-12', '2026-11', '2026-10'])
    assert.deepEqual(raidMonths([]), [])
  })

  test('skip a date that is not a date', () => {
    assert.deepEqual(raidMonths([{ date: '' }, { date: 'soon' }, { date: '2026-12-01' }]), ['2026-12'])
  })

  test('are named in full, whatever the viewer time zone', () => {
    assert.equal(monthOf('2026-12-31'), '2026-12')
    assert.equal(monthLabel('2026-12'), 'December 2026')
    assert.equal(monthLabel('2027-01'), 'January 2027')
    assert.equal(monthLabel('nonsense'), 'nonsense')
  })
})

describe('paging', () => {
  test('shows 25 raids at a time', () => {
    assert.equal(PAGE_SIZE, 25)
    const many = Array.from({ length: 260 }, (_, index) => raid(`raid-${String(index).padStart(3, '0')}`, `2026-${String(1 + (index % 12)).padStart(2, '0')}-10`, '21:00', -(index + 1) * 24))
    const listed = categorizedRaids(many, NOW, timeOf)
    assert.equal(listed.length, 260)
    assert.equal(listed.slice(0, PAGE_SIZE).length, 25)
    assert.equal(new Set(listed.map(({ raid: entry }) => entry.id)).size, 260, 'every raid once')
  })
})
