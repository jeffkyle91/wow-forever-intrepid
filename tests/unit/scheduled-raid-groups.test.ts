// Which scheduled raids are rows still to come and which are in the older group (features/scheduled-raids/groupRaids.ts).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { groupScheduledRaids, isClosedRaid, nextStartAfter } from '../../src/features/scheduled-raids/groupRaids.ts'

const NOW = Date.parse('2026-12-10T12:00:00Z')
const at = (offsetHours: number) => ({ toMillis: () => NOW + offsetHours * 3_600_000 })
const raid = (name: string, offsetHours: number | null, status?: string) => ({ name, ...(offsetHours === null ? {} : { startsAt: at(offsetHours) }), ...(status ? { status } : {}) })

describe('a raid is closed', () => {
  test('when it is cancelled, has started, or has no saved start time', () => {
    assert.equal(isClosedRaid(raid('later', 5), NOW), false)
    assert.equal(isClosedRaid(raid('cancelled', 5, 'cancelled'), NOW), true, 'a cancelled raid is closed even before its start')
    assert.equal(isClosedRaid(raid('started', -1), NOW), true)
    assert.equal(isClosedRaid(raid('legacy', null), NOW), true, 'a raid with no saved start time is read-only')
    assert.equal(isClosedRaid(raid('scheduled', 5, 'scheduled'), NOW), false)
  })

  test('at the very moment it starts', () => {
    assert.equal(isClosedRaid(raid('now', 0), NOW), true)
    assert.equal(isClosedRaid(raid('a moment later', 0.0001), NOW), false)
  })
})

describe('the raids still to come and the older ones', () => {
  const sorted = [raid('legacy', null), raid('old', -48), raid('cancelled', 2, 'cancelled'), raid('started', -1), raid('soon', 3), raid('later', 30)]

  test('upcoming raids keep the order given and older ones come most recent first', () => {
    const { upcoming, older } = groupScheduledRaids(sorted, NOW)
    assert.deepEqual(upcoming.map((entry) => entry.name), ['soon', 'later'])
    assert.deepEqual(older.map((entry) => entry.name), ['started', 'cancelled', 'old', 'legacy'])
  })

  test('every raid is in exactly one group', () => {
    const { upcoming, older } = groupScheduledRaids(sorted, NOW)
    assert.equal(upcoming.length + older.length, sorted.length)
  })

  test('no raids, or only upcoming ones, give an empty older group', () => {
    assert.deepEqual(groupScheduledRaids([], NOW), { upcoming: [], older: [] })
    assert.equal(groupScheduledRaids([raid('soon', 3)], NOW).older.length, 0)
  })

  test('a raid moves to the older group when time passes its start', () => {
    assert.equal(groupScheduledRaids([raid('soon', 3)], NOW + 4 * 3_600_000).upcoming.length, 0)
  })
})

describe('when the next raid still to come starts', () => {
  test('is the soonest start in the future, ignoring cancelled raids, started ones and raids with no start time', () => {
    const raids = [raid('legacy', null), raid('started', -1), raid('cancelled', 1, 'cancelled'), raid('later', 30), raid('soon', 3)]
    assert.equal(nextStartAfter(raids, NOW), NOW + 3 * 3_600_000)
  })

  test('is none when nothing is still to come', () => {
    assert.equal(nextStartAfter([], NOW), undefined)
    assert.equal(nextStartAfter([raid('started', -1), raid('cancelled', 4, 'cancelled')], NOW), undefined)
  })
})
