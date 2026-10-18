import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { awardsRecordedFrom, carriedFromName, carriedLabel } from '../../src/features/loot/carried.ts'
import { withToggled } from '../../src/features/loot/orderLock.ts'

// Invented ids and phases.
const phaseName = (no: number) => (no === 0 ? 'Launch prep' : `Phase ${no}`)
const lookup = (id: string) => (id === 'p-old' ? { phaseNo: 0 } : id === 'p-mid' ? { phaseNo: 1 } : id === 'p-first' ? {} : undefined)

describe('the lock on the order of a priority', () => {
  it('unlocks an item that was locked and locks it again, one item at a time', () => {
    const none: ReadonlySet<string> = new Set()
    const one = withToggled(none, 'a')
    assert.deepEqual([...one], ['a'])
    assert.deepEqual([...withToggled(one, 'b')].sort(), ['a', 'b'])
    assert.deepEqual([...withToggled(withToggled(one, 'b'), 'a')], ['b'])
    assert.equal(withToggled(one, 'a').size, 0)
  })
  it('never changes the set it is given', () => {
    const before: ReadonlySet<string> = new Set(['a'])
    withToggled(before, 'a')
    withToggled(before, 'b')
    assert.deepEqual([...before], ['a'])
  })
})

describe('a priority carried over from an earlier phase', () => {
  it('says which phase it came from, by the phase of the priority it points at (none means the first phase)', () => {
    assert.equal(carriedLabel({ carriedFrom: 'p-old' }, lookup, phaseName), 'Carried over from Launch prep')
    assert.equal(carriedLabel({ carriedFrom: 'p-mid' }, lookup, phaseName), 'Carried over from Phase 1')
    assert.equal(carriedLabel({ carriedFrom: 'p-first' }, lookup, phaseName), 'Carried over from Launch prep')
    assert.equal(carriedFromName({ carriedFrom: 'p-mid' }, lookup, phaseName), 'Phase 1')
  })
  it('still says it was carried over when the priority it came from is gone, and says nothing for one that was not carried over', () => {
    assert.equal(carriedLabel({ carriedFrom: 'p-gone' }, lookup, phaseName), 'Carried over')
    assert.equal(carriedFromName({ carriedFrom: 'p-gone' }, lookup, phaseName), undefined)
    assert.equal(carriedLabel({}, lookup, phaseName), undefined)
  })
  it('counts the awards recorded from that very priority, not the ones that were removed, nor those of another priority', () => {
    const awards = [{ priorityId: 'p1' }, { priorityId: 'p1', status: 'removed' }, { priorityId: 'p1', status: 'active' }, { priorityId: 'p2' }, {}]
    assert.equal(awardsRecordedFrom({ id: 'p1' }, awards), 2)
    assert.equal(awardsRecordedFrom({ id: 'p9' }, awards), 0)
  })
})
