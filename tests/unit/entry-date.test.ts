import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { dateChoices, entryDate, localDay } from '../../src/features/loot/entryDate.ts'
import { logFilterActive, matchesLogFilter, noLogFilter, type LogFacts } from '../../src/features/loot/logFilters.ts'

// Invented data. Dates built with the local calendar, as the Log reads them.
const entry = (overrides: Record<string, unknown>) => ({ targetType: 'priority', targetId: 'p1', at: new Date(2026, 11, 10, 8, 30), before: {}, after: {}, ...overrides }) as Parameters<typeof entryDate>[0]
const none = () => undefined

describe('the day of an entry', () => {
  it('writes a moment as the viewer\'s calendar day, with two-digit month and day', () => {
    assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05')
    assert.equal(localDay(new Date(2026, 11, 9, 0, 1)), '2026-12-09')
  })
  it('is the raid night for an award, not the day it was typed in', () => {
    const typedNextMorning = entry({ targetType: 'award', targetId: 'a1', at: new Date(2026, 11, 10, 8, 30) })
    assert.equal(entryDate(typedNextMorning, (id) => (id === 'a1' ? '2026-12-09' : undefined)), '2026-12-09')
  })
  it('is the night the entry says when the award is not known, from what it lists (after, else before)', () => {
    assert.equal(entryDate(entry({ targetType: 'award', after: { awardedAt: '2026-12-09' } }), none), '2026-12-09')
    assert.equal(entryDate(entry({ targetType: 'award', before: { awardedAt: '2026-12-08' } }), none), '2026-12-08')
  })
  it('falls back to the day it was made for an award that says nothing, and ignores a night that is not a date', () => {
    assert.equal(entryDate(entry({ targetType: 'award', after: { awardedAt: 'last Tuesday' } }), none), '2026-12-10')
    assert.equal(entryDate(entry({ targetType: 'award' }), none), '2026-12-10')
  })
  it('is the day it was made for a priority, a phase or a drop list', () => {
    for (const targetType of ['priority', 'phase', 'table']) assert.equal(entryDate(entry({ targetType, after: { awardedAt: '2020-01-01' } }), () => '2020-01-01'), '2026-12-10')
  })
  it('is none when an entry has no time and no night', () => {
    assert.equal(entryDate(entry({ at: null }), none), undefined)
    assert.equal(entryDate(entry({ targetType: 'award', at: null }), none), undefined)
  })
})

describe('the days the dropdown offers', () => {
  it('lists each day once with how many entries it has, newest first', () => {
    assert.deepEqual(dateChoices(['2026-12-09', '2026-12-16', '2026-12-09', undefined, '2026-12-09'], ''), [{ date: '2026-12-16', count: 1 }, { date: '2026-12-09', count: 3 }])
  })
  it('always includes the day chosen, even when nothing is on it now', () => {
    assert.deepEqual(dateChoices(['2026-12-09'], '2026-11-01'), [{ date: '2026-12-09', count: 1 }, { date: '2026-11-01', count: 0 }])
  })
  it('offers nothing for no days', () => {
    assert.deepEqual(dateChoices([], ''), [])
  })
})

describe('the date filter', () => {
  const slotOf = () => undefined
  const facts = (overrides: Partial<LogFacts>): LogFacts => ({ about: 'item', item: 'Iron Ring', encounter: '', players: [], ...overrides })
  it('is active when a day is chosen', () => {
    assert.equal(logFilterActive(noLogFilter), false)
    assert.ok(logFilterActive({ ...noLogFilter, date: '2026-12-09' }))
  })
  it('shows only the entries of that day, whatever they are about', () => {
    const filter = { ...noLogFilter, date: '2026-12-09' }
    assert.ok(matchesLogFilter(facts({ date: '2026-12-09' }), filter, slotOf))
    assert.ok(matchesLogFilter(facts({ about: 'phase', date: '2026-12-09' }), filter, slotOf))
    assert.equal(matchesLogFilter(facts({ date: '2026-12-10' }), filter, slotOf), false)
    assert.equal(matchesLogFilter(facts({}), filter, slotOf), false)
  })
  it('combines with the phase and with the item filters', () => {
    const filter = { ...noLogFilter, date: '2026-12-09', phase: '1', player: 'name:aria' }
    const aria = [{ key: 'name:aria', name: 'Aria' }]
    assert.ok(matchesLogFilter(facts({ date: '2026-12-09', phase: 1, players: aria }), filter, slotOf))
    assert.equal(matchesLogFilter(facts({ date: '2026-12-09', phase: 0, players: aria }), filter, slotOf), false)
    assert.equal(matchesLogFilter(facts({ date: '2026-12-10', phase: 1, players: aria }), filter, slotOf), false)
    assert.equal(matchesLogFilter(facts({ about: 'phase', date: '2026-12-09', phase: 1 }), filter, slotOf), false)
  })
})
