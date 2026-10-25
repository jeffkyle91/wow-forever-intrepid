// My dashboard shows the phase the guild is in and nothing else (MEMBER-006): what an earlier phase still owed moves forward with Carry over, and the rest is history, which the
// Log keeps. Names are invented: this repository is public.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { inPhase, myAwards, myPriorities } from '../../src/features/dashboard/myCharacters.ts'

const mine = [{ id: 'p-1', name: 'Morrowind', className: 'Warlock', specialization: 'Demonology' }]
const list = (id: string, overrides: Record<string, unknown> = {}) => ({ id, item: `Item ${id}`, encounter: 'Test Hall · Warden', councilNote: '', rankedPlayers: ['Morrowind'], rankedIds: ['p-1'], ...overrides })
const award = (id: string, overrides: Record<string, unknown> = {}) => ({ id, item: `Item ${id}`, encounter: 'Test Hall · Warden', recipient: 'Morrowind', recipientId: 'p-1', awardedAt: '2026-12-09', ...overrides })

describe('inPhase', () => {
  it('keeps only the records of that phase', () => {
    const records = [{ id: 'a', phaseNo: 0 }, { id: 'b', phaseNo: 1 }, { id: 'c', phaseNo: 2 }, { id: 'd', phaseNo: 1 }]
    assert.deepEqual(inPhase(records, 1).map((record) => record.id), ['b', 'd'])
    assert.deepEqual(inPhase(records, 2).map((record) => record.id), ['c'])
  })
  it('treats a record with no phase, or a phase that is not a phase number, as the first phase\'s', () => {
    const records = [{ id: 'a' }, { id: 'b', phaseNo: 'two' }, { id: 'c', phaseNo: -1 }, { id: 'd', phaseNo: 0 }, { id: 'e', phaseNo: 1 }]
    assert.deepEqual(inPhase(records, 0).map((record) => record.id), ['a', 'b', 'c', 'd'])
    assert.deepEqual(inPhase(records, 1).map((record) => record.id), ['e'])
  })
  it('gives nothing for nothing, and for a phase nobody wrote anything in', () => {
    assert.deepEqual(inPhase([], 3), [])
    assert.deepEqual(inPhase([{ phaseNo: 0 }], 3), [])
  })
})

describe('what My dashboard lists once the guild is in the second phase', () => {
  const lists = [list('old-unreceived', { phaseNo: 0 }), list('now', { phaseNo: 1 }), list('prepared-next', { phaseNo: 2 })]
  it('lists a priority of the current phase, and not an earlier phase\'s that was never received, nor the next phase\'s', () => {
    const found = myPriorities(inPhase(lists, 1) as never, mine as never)
    assert.deepEqual(found.map((entry) => entry.priority.id), ['now'])
  })
  it('lists the awards of the current phase only, and still not a removed one', () => {
    const awards = [award('a-old', { phaseNo: 0 }), award('a-now', { phaseNo: 1 }), award('a-removed', { phaseNo: 1, status: 'removed', removedReason: 'Entered twice' }), award('a-other', { phaseNo: 1, recipient: 'Someone Else', recipientId: 'p-9' })]
    assert.deepEqual(myAwards(inPhase(awards, 1) as never, mine as never).map((entry) => entry.id), ['a-now'])
  })
  it('shows an award from before phases existed (no phase written) in the first phase only', () => {
    const awards = [award('legacy')]
    assert.equal(myAwards(inPhase(awards, 0) as never, mine as never).length, 1)
    assert.equal(myAwards(inPhase(awards, 1) as never, mine as never).length, 0)
  })
  it('would list the old priority if the earlier-phases rule were still in place (the rule this replaces)', () => {
    const upTo = lists.filter((record) => (record.phaseNo as number) <= 1)
    assert.deepEqual(myPriorities(upTo as never, mine as never).map((entry) => entry.priority.id).sort(), ['now', 'old-unreceived'])
  })
})
