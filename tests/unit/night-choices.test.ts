import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { dayBefore, NIGHT_BY, nightCounts, nightRaidChoices, pickedRaid } from '../../src/features/loot/nightChoices.ts'

// Every name here is invented: this repository is public.
const raid = (id: string, date: string, extra: { time?: string; status?: string } = {}) => ({ id, date, name: `Test Night ${id}`, size: 20 as const, ...extra })

describe('dayBefore', () => {
  it('steps back one calendar day, across months, years and leap days', () => {
    assert.equal(dayBefore('2026-11-14'), '2026-11-13')
    assert.equal(dayBefore('2026-12-01'), '2026-11-30')
    assert.equal(dayBefore('2027-01-01'), '2026-12-31')
    assert.equal(dayBefore('2028-03-01'), '2028-02-29')
  })
})

describe('nightRaidChoices', () => {
  it("starts on today's raid", () => {
    const choices = nightRaidChoices([raid('r-next', '2026-11-18'), raid('r-today', '2026-11-14')], '2026-11-14')
    assert.equal(choices.defaultId, 'r-today')
  })

  it('starts on the next raid when none is today', () => {
    const choices = nightRaidChoices([raid('r-later', '2026-11-25'), raid('r-past', '2026-11-13'), raid('r-next', '2026-11-18')], '2026-11-14')
    assert.equal(choices.defaultId, 'r-next')
  })

  it('starts on no raid when none is today or later', () => {
    assert.equal(nightRaidChoices([raid('r-past', '2026-11-13')], '2026-11-14').defaultId, '')
    assert.equal(nightRaidChoices([], '2026-11-14').defaultId, '')
  })

  it('never offers or starts on a cancelled raid', () => {
    const choices = nightRaidChoices([raid('r-off', '2026-11-14', { status: 'cancelled' }), raid('r-next', '2026-11-18')], '2026-11-14')
    assert.deepEqual(choices.raids.map((choice) => choice.id), ['r-next'])
    assert.equal(choices.defaultId, 'r-next')
  })

  it('offers raids marked complete, and the one of the day before, but nothing earlier', () => {
    const choices = nightRaidChoices([raid('r-old', '2026-11-12'), raid('r-last', '2026-11-13'), raid('r-done', '2026-11-14', { status: 'complete' })], '2026-11-14')
    assert.deepEqual(choices.raids.map((choice) => choice.id), ['r-last', 'r-done'])
    assert.equal(choices.defaultId, 'r-done')
  })

  it('orders by date, then start time (a raid with none starts at 21:00), and starts on the earliest of today', () => {
    const choices = nightRaidChoices([
      raid('r-late', '2026-11-14', { time: '22:30' }),
      raid('r-usual', '2026-11-14'),
      raid('r-early', '2026-11-14', { time: '19:00' }),
      raid('r-next', '2026-11-15', { time: '18:00' }),
    ], '2026-11-14')
    assert.deepEqual(choices.raids.map((choice) => choice.id), ['r-early', 'r-usual', 'r-late', 'r-next'])
    assert.equal(choices.defaultId, 'r-early')
  })

  it('leaves the list it is given as it was', () => {
    const raids = [raid('r-b', '2026-11-20'), raid('r-a', '2026-11-15')]
    nightRaidChoices(raids, '2026-11-14')
    assert.deepEqual(raids.map((choice) => choice.id), ['r-b', 'r-a'])
  })
})

describe('pickedRaid', () => {
  const choices = nightRaidChoices([raid('r-today', '2026-11-14'), raid('r-next', '2026-11-18')], '2026-11-14')

  it('is the default until the leader picks', () => {
    assert.equal(pickedRaid(choices, null)?.id, 'r-today')
  })

  it('is the raid picked, or none', () => {
    assert.equal(pickedRaid(choices, 'r-next')?.id, 'r-next')
    assert.equal(pickedRaid(choices, ''), undefined)
  })

  it('is none when the raid picked is no longer offered', () => {
    assert.equal(pickedRaid(choices, 'r-gone'), undefined)
  })
})

describe('nightCounts', () => {
  it('counts players, priorities, bosses and characters', () => {
    assert.equal(nightCounts({ roster: [1, 2], priorities: [1, 2, 3], bosses: [1] }, 12345), '2 players · 3 priorities · 1 boss · 12,345 characters')
  })

  it('says one in the singular and counts no bosses when the list is left out', () => {
    assert.equal(nightCounts({ roster: [1], priorities: [1] }, 1), '1 player · 1 priority · 0 bosses · 1 character')
  })
})

describe('NIGHT_BY', () => {
  it('is a producer the spec accepts: RaidDesk and a part, no person', () => {
    assert.match(NIGHT_BY, /^RaidDesk\/\S+$/)
    assert.ok([...NIGHT_BY].length <= 60)
  })
})
