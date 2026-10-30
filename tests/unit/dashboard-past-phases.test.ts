// My dashboard can look back at a finished phase (MEMBER-008): which phases it offers, which one it shows, and what it lists for a finished phase.
// Names are invented: this repository is public.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { dashboardPhases, shownPhase } from '../../src/features/dashboard/dashboardPhase.ts'
import { inPhase, myAwards, myPriorities } from '../../src/features/dashboard/myCharacters.ts'
import { priorityLookup } from '../../src/shared/game/completion.ts'

// Three phases so far: two finished ("Launch prep" is phase 0), "Phase 2" is current and "Phase 3" is being prepared.
const settings = { currentPhase: 'Phase 2', nextPhase: 'Phase 3', phaseHistory: ['Launch prep', 'Phase 1'] }
const firstPhase = { currentPhase: 'Launch prep', nextPhase: 'To be announced' }

describe('the phases My dashboard offers', () => {
  it('are the current phase and the finished ones, newest first, and never the next phase', () => {
    assert.deepEqual(dashboardPhases(settings).map((option) => [option.no, option.name, option.kind]), [[2, 'Phase 2', 'current'], [1, 'Phase 1', 'past'], [0, 'Launch prep', 'past']])
  })
  it('are one, the current phase, until a phase has finished (so the dashboard shows no choice)', () => {
    assert.deepEqual(dashboardPhases(firstPhase).map((option) => [option.no, option.kind]), [[0, 'current']])
  })
})

describe('the phase My dashboard shows', () => {
  it('is the current phase until a member picks one', () => {
    assert.equal(shownPhase(settings, null).no, 2)
    assert.equal(shownPhase(firstPhase, null).no, 0)
  })
  it('is the finished phase a member picked', () => {
    assert.deepEqual([shownPhase(settings, { no: 1, whenCurrent: 2 }).name, shownPhase(settings, { no: 1, whenCurrent: 2 }).kind], ['Phase 1', 'past'])
    assert.equal(shownPhase(settings, { no: 0, whenCurrent: 2 }).name, 'Launch prep')
  })
  it('goes back to the current phase when the guild has started a new phase since the pick', () => {
    assert.equal(shownPhase(settings, { no: 0, whenCurrent: 1 }).no, 2)
    assert.equal(shownPhase({ ...settings, phaseHistory: [...settings.phaseHistory, 'Phase 2'], currentPhase: 'Phase 3', nextPhase: 'To be announced' }, { no: 1, whenCurrent: 2 }).no, 3)
  })
  it('is the current phase for a pick that is not offered: the next phase, or a phase that does not exist', () => {
    assert.equal(shownPhase(settings, { no: 3, whenCurrent: 2 }).no, 2)
    assert.equal(shownPhase(settings, { no: 9, whenCurrent: 2 }).no, 2)
    assert.equal(shownPhase(settings, { no: -1, whenCurrent: 2 }).no, 2)
  })
  it('is the current phase after picking the current phase', () => {
    assert.equal(shownPhase(settings, { no: 2, whenCurrent: 2 }).kind, 'current')
  })
})

describe('what My dashboard lists for a finished phase', () => {
  const mine = [{ id: 'p-1', name: 'Morrowind', className: 'Warlock', specialization: 'Demonology' }]
  const list = (id: string, overrides: Record<string, unknown> = {}) => ({ id, item: `Item ${id}`, encounter: 'Test Hall · Warden', councilNote: '', rankedPlayers: ['Morrowind'], rankedIds: ['p-1'], ...overrides })
  const award = (id: string, overrides: Record<string, unknown> = {}) => ({ id, item: `Item ${id}`, encounter: 'Test Hall · Warden', recipient: 'Morrowind', recipientId: 'p-1', awardedAt: '2026-12-09', ...overrides })
  const lists = [list('first', { phaseNo: 0 }), list('second', { phaseNo: 1 }), list('second-b', { phaseNo: 1 }), list('now', { phaseNo: 2 }), list('prepared', { phaseNo: 3 })]
  const awards = [
    award('a-first', { phaseNo: 0 }),
    award('a-second', { phaseNo: 1, priorityId: 'second' }),
    award('a-second-removed', { phaseNo: 1, status: 'removed', removedReason: 'Entered twice' }),
    award('a-second-other', { phaseNo: 1, recipient: 'Somebody', recipientId: 'p-9' }),
    award('a-now', { phaseNo: 2 }),
  ]

  it('is that phase\'s priorities and nothing from another phase, the next phase\'s included', () => {
    const phase = shownPhase(settings, { no: 1, whenCurrent: 2 })
    assert.deepEqual(myPriorities(inPhase(lists, phase.no) as never, mine as never).map((entry) => entry.priority.id), ['second', 'second-b'])
  })
  it('is that phase\'s awards to this account\'s characters, and still not a removed one or another player\'s', () => {
    const phase = shownPhase(settings, { no: 1, whenCurrent: 2 })
    assert.deepEqual(myAwards(inPhase(awards, phase.no) as never, mine as never).map((entry) => entry.id), ['a-second'])
  })
  it('keeps the received mark a listing had in that phase, working it out from every award as the current phase does', () => {
    const phase = shownPhase(settings, { no: 1, whenCurrent: 2 })
    const found = myPriorities(inPhase(lists, phase.no) as never, mine as never, awards as never, priorityLookup(lists) as never)
    assert.deepEqual(found.map((entry) => [entry.priority.id, entry.received]), [['second', true], ['second-b', false]])
  })
  it('is the same as before when the current phase is shown', () => {
    const phase = shownPhase(settings, null)
    assert.deepEqual(myPriorities(inPhase(lists, phase.no) as never, mine as never).map((entry) => entry.priority.id), ['now'])
    assert.deepEqual(myAwards(inPhase(awards, phase.no) as never, mine as never).map((entry) => entry.id), ['a-now'])
  })
})
