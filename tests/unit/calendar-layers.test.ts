// What the Guild Calendar shows for a day, and the line shown when both kinds are hidden (features/calendar/calendarLayers.ts).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { absencesOnDay, ALL_LAYERS, hiddenNote, raidsOnDay, withRaidsShown, type CalendarLayers } from '../../src/features/calendar/calendarLayers.ts'

const raids = [
  { id: 'a', date: '2026-12-09' },
  { id: 'b', date: '2026-12-09', status: 'cancelled' },
  { id: 'c', date: '2026-12-10' },
]
const entries = [
  { id: 'own', startDate: '2026-12-08', endDate: '2026-12-10' },
  { id: 'other', startDate: '2026-12-09', endDate: '2026-12-09' },
  { id: 'later', startDate: '2026-12-11', endDate: '2026-12-12' },
]
const only = (kind: 'raids' | 'absences'): CalendarLayers => ({ raids: kind === 'raids', absences: kind === 'absences' })
const NONE: CalendarLayers = { raids: false, absences: false }
const ids = (list: readonly { id: string }[]) => list.map((item) => item.id)

describe('with both kinds on, which is the default', () => {
  test('a day shows every raid on it, cancelled ones included, in the order given', () => {
    assert.deepEqual(ALL_LAYERS, { raids: true, absences: true })
    assert.deepEqual(ids(raidsOnDay(raids, '2026-12-09', ALL_LAYERS)), ['a', 'b'])
    assert.deepEqual(ids(raidsOnDay(raids, '2026-12-11', ALL_LAYERS)), [])
  })

  test('a day shows every unavailable range that covers it, first and last day included', () => {
    assert.deepEqual(ids(absencesOnDay(entries, '2026-12-08', ALL_LAYERS)), ['own'])
    assert.deepEqual(ids(absencesOnDay(entries, '2026-12-09', ALL_LAYERS)), ['own', 'other'])
    assert.deepEqual(ids(absencesOnDay(entries, '2026-12-10', ALL_LAYERS)), ['own'])
    assert.deepEqual(ids(absencesOnDay(entries, '2026-12-11', ALL_LAYERS)), ['later'])
    assert.deepEqual(ids(absencesOnDay(entries, '2026-12-13', ALL_LAYERS)), [])
  })
})

describe('with one kind off', () => {
  test('Raids off removes every raid, cancelled ones too, and leaves the absences', () => {
    assert.deepEqual(raidsOnDay(raids, '2026-12-09', only('absences')), [])
    assert.deepEqual(ids(absencesOnDay(entries, '2026-12-09', only('absences'))), ['own', 'other'])
  })

  test('Absences off removes every range, the viewer\'s own and the others\', and leaves the raids', () => {
    assert.deepEqual(absencesOnDay(entries, '2026-12-09', only('raids')), [])
    assert.deepEqual(ids(raidsOnDay(raids, '2026-12-09', only('raids'))), ['a', 'b'])
  })
})

describe('with both kinds off', () => {
  test('a day shows nothing, and the note says why', () => {
    assert.deepEqual(raidsOnDay(raids, '2026-12-09', NONE), [])
    assert.deepEqual(absencesOnDay(entries, '2026-12-09', NONE), [])
    assert.match(hiddenNote(NONE) ?? '', /hidden/)
  })

  test('there is no note while either kind is shown', () => {
    assert.equal(hiddenNote(ALL_LAYERS), undefined)
    assert.equal(hiddenNote(only('raids')), undefined)
    assert.equal(hiddenNote(only('absences')), undefined)
  })
})

describe('the results', () => {
  test('are new arrays each time, so a caller may sort them without touching the data', () => {
    assert.notEqual(raidsOnDay(raids, '2026-12-09', ALL_LAYERS), raids)
    assert.notEqual(raidsOnDay(raids, '2026-12-09', NONE), raidsOnDay(raids, '2026-12-09', NONE))
  })
})

describe('opening the calendar from a raid link', () => {
  test('turns Raids on and leaves Absences as they were', () => {
    assert.deepEqual(withRaidsShown(NONE), { raids: true, absences: false })
    assert.deepEqual(withRaidsShown(only('absences')), { raids: true, absences: true })
  })

  test('changes nothing, and returns the same object, when Raids are already on', () => {
    assert.equal(withRaidsShown(ALL_LAYERS), ALL_LAYERS)
    const raidsOnly = only('raids')
    assert.equal(withRaidsShown(raidsOnly), raidsOnly)
  })
})
