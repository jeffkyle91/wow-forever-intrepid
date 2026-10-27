// Which raids Scheduled Raids lists, and when its list next changes (features/scheduled-raids/groupRaids.ts).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { isClosedRaid, isListedRaid, listedRaids, nextChangeAfter, STAYS_AFTER_START_MS } from '../../src/features/scheduled-raids/groupRaids.ts'

const NOW = Date.parse('2026-12-10T12:00:00Z')
const HOUR = 3_600_000
const at = (offsetHours: number) => ({ toMillis: () => NOW + offsetHours * HOUR })
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

describe('a raid is listed', () => {
  test('stays 5 hours after its start', () => {
    assert.equal(STAYS_AFTER_START_MS, 5 * HOUR)
    assert.equal(isListedRaid(raid('later', 30), NOW), true)
    assert.equal(isListedRaid(raid('starting now', 0), NOW), true)
    assert.equal(isListedRaid(raid('started', -2), NOW), true)
    assert.equal(isListedRaid(raid('nearly 5 hours in', -4.99), NOW), true)
  })

  test('and leaves at the moment 5 hours have passed', () => {
    assert.equal(isListedRaid(raid('5 hours in', -5), NOW), false)
    assert.equal(isListedRaid(raid('6 hours in', -6), NOW), false)
    assert.equal(isListedRaid(raid('last week', -168), NOW), false)
  })

  test('cancelled or not, a cancelled raid follows the same window', () => {
    assert.equal(isListedRaid(raid('cancelled, still to come', 20, 'cancelled'), NOW), true)
    assert.equal(isListedRaid(raid('cancelled, 2 hours past', -2, 'cancelled'), NOW), true)
    assert.equal(isListedRaid(raid('cancelled, 6 hours past', -6, 'cancelled'), NOW), false)
  })

  test('a raid with no saved start time is not listed, whenever it was', () => {
    assert.equal(isListedRaid(raid('legacy', null), NOW), false)
  })
})

describe('the list', () => {
  const sorted = [raid('legacy', null), raid('last week', -168), raid('long over', -6), raid('started', -2), raid('cancelled', 2, 'cancelled'), raid('soon', 3), raid('later', 30)]

  test('keeps the order given, so a raid that has started sits above the ones still to come', () => {
    assert.deepEqual(listedRaids(sorted, NOW).map((entry) => entry.name), ['started', 'cancelled', 'soon', 'later'])
  })

  test('is empty when there are no raids, or none within the window', () => {
    assert.deepEqual(listedRaids([], NOW), [])
    assert.deepEqual(listedRaids([raid('long over', -6), raid('legacy', null)], NOW), [])
  })

  test('drops a raid when time passes 5 hours after its start', () => {
    assert.equal(listedRaids([raid('started', -2)], NOW + 2 * HOUR).length, 1)
    assert.equal(listedRaids([raid('started', -2)], NOW + 3 * HOUR).length, 0)
  })
})

describe('when the list next changes', () => {
  test('is the soonest start or departure in the future', () => {
    const raids = [raid('legacy', null), raid('started', -1), raid('later', 30), raid('soon', 3)]
    assert.equal(nextChangeAfter(raids, NOW), NOW + 3 * HOUR, 'the soon raid starts before the started raid leaves at +4')
  })

  test('is the departure of a raid in progress when nothing starts sooner', () => {
    assert.equal(nextChangeAfter([raid('started', -4), raid('later', 30)], NOW), NOW + HOUR)
  })

  test('counts a cancelled raid, which also leaves 5 hours after its start', () => {
    assert.equal(nextChangeAfter([raid('cancelled', -4.5, 'cancelled')], NOW), NOW + 0.5 * HOUR)
  })

  test('ignores moments already past and raids with no start time, and is none when nothing is left', () => {
    assert.equal(nextChangeAfter([], NOW), undefined)
    assert.equal(nextChangeAfter([raid('long over', -6), raid('legacy', null)], NOW), undefined)
    assert.equal(nextChangeAfter([raid('started', -1)], NOW + 4 * HOUR), undefined)
  })
})
