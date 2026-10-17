import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { currentPhaseNo, isPhaseNo, phaseLabel, phaseNoOf, phaseOptions, readPhaseHistory, viewedPhase, withoutBadPhaseFields } from '../../src/shared/game/phases.ts'

// Invented phase names.
const fresh = { currentPhase: 'Launch', nextPhase: 'Second' }
const later = { currentPhase: 'Third', nextPhase: 'Fourth', phaseHistory: ['Launch', 'Second'] }
const view = (options: ReturnType<typeof phaseOptions>) => options.map((option) => [option.no, option.name, option.kind])

describe('phase numbers', () => {
  it('is phase 0 until a phase has been closed, and then the number of closed phases', () => {
    assert.equal(currentPhaseNo(fresh), 0)
    assert.equal(currentPhaseNo({ phaseHistory: [] }), 0)
    assert.equal(currentPhaseNo(later), 2)
  })
  it('reads a record with no phase, or an invalid one, as phase 0', () => {
    assert.equal(phaseNoOf({}), 0)
    assert.equal(phaseNoOf({ phaseNo: 3 }), 3)
    for (const bad of [-1, 1.5, '2', null, NaN, Infinity]) assert.equal(phaseNoOf({ phaseNo: bad }), 0)
  })
  it('accepts only whole numbers of 0 or more', () => {
    assert.ok(isPhaseNo(0) && isPhaseNo(7))
    for (const bad of [-1, 0.5, '1', undefined, null, NaN]) assert.equal(isPhaseNo(bad), false)
  })
})

describe('phaseOptions', () => {
  it('lists the next phase, the current one, then the finished ones, newest first', () => {
    assert.deepEqual(view(phaseOptions(later, true)), [[3, 'Fourth', 'next'], [2, 'Third', 'current'], [1, 'Second', 'past'], [0, 'Launch', 'past']])
  })
  it('leaves the next phase out when it is not asked for', () => {
    assert.deepEqual(view(phaseOptions(later, false)), [[2, 'Third', 'current'], [1, 'Second', 'past'], [0, 'Launch', 'past']])
  })
  it('has only the current phase (and the next) for a guild that never closed one', () => {
    assert.deepEqual(view(phaseOptions(fresh, false)), [[0, 'Launch', 'current']])
    assert.deepEqual(view(phaseOptions(fresh, true)), [[1, 'Second', 'next'], [0, 'Launch', 'current']])
  })
  it('labels the current and next phase and leaves a finished one as it is named', () => {
    assert.deepEqual(phaseOptions(later, true).map(phaseLabel), ['Fourth (next)', 'Third (current)', 'Second', 'Launch'])
  })
})

describe('viewedPhase', () => {
  it('shows the phase asked for when it exists', () => {
    assert.equal(viewedPhase(later, 1, false).name, 'Second')
    assert.equal(viewedPhase(later, 3, true).kind, 'next')
  })
  it('falls back to the current phase when none is asked for or it is not available', () => {
    assert.equal(viewedPhase(later, null, false).kind, 'current')
    assert.equal(viewedPhase(later, 3, false).kind, 'current')
    assert.equal(viewedPhase(later, 9, true).kind, 'current')
  })
})

describe('readPhaseHistory', () => {
  // The same reader Settings uses for a name: text, trimmed, or the fallback.
  const name = (entry: unknown, fallback: string) => (typeof entry === 'string' && entry.trim() ? entry.slice(0, 40) : fallback)
  it('gives nothing for a missing, empty or unreadable history, so a guild that never closed a phase writes none', () => {
    for (const none of [undefined, null, [], 'One', { 0: 'One' }]) assert.equal(readPhaseHistory(none, name), undefined)
  })
  it('reads the names, keeping the count when one cannot be read', () => {
    assert.deepEqual(readPhaseHistory(['One', 7, '  ', 'Four'], name), ['One', 'Phase 2', 'Phase 3', 'Four'])
  })
  it('caps a very long history', () => assert.equal(readPhaseHistory(Array.from({ length: 80 }, (_, index) => `P${index}`), name)?.length, 30))
})

describe('withoutBadPhaseFields', () => {
  const base = { item: 'Test Cloak' }
  it('keeps a valid phase number and carried-from id', () => assert.deepEqual(withoutBadPhaseFields({ ...base, phaseNo: 2, carriedFrom: 'p0' }), { ...base, phaseNo: 2, carriedFrom: 'p0' }))
  it('keeps phase 0', () => assert.equal(withoutBadPhaseFields({ ...base, phaseNo: 0 }).phaseNo, 0))
  it('removes a phase number that is not valid', () => {
    for (const bad of [-1, 1.5, '2', null, NaN]) assert.equal('phaseNo' in withoutBadPhaseFields({ ...base, phaseNo: bad }), false)
  })
  it('removes a carried-from id that is not a non-empty text', () => {
    for (const bad of ['', 5, null]) assert.equal('carriedFrom' in withoutBadPhaseFields({ ...base, carriedFrom: bad }), false)
  })
  it('leaves a record with no phase fields as it is, and does not change what it was given', () => {
    assert.deepEqual(withoutBadPhaseFields(base), base)
    const given = { ...base, phaseNo: -1 }
    withoutBadPhaseFields(given)
    assert.equal(given.phaseNo, -1)
  })
})
