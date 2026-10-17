import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { carryOverFields, onTargetList } from '../../src/features/loot/carryOver.ts'
import { awardsForPriority, listingProgress, priorityLookup } from '../../src/features/loot/completion.ts'

// Invented names and items.
const source = { id: 'p1', item: 'Iron Ring', encounter: 'Test Hall \u00b7 Warden', rankedPlayers: ['Aria', 'Brock', 'Aria'], councilNote: 'Healer first', itemId: 101, zoneId: 7, npcId: 10, phaseNo: 0 }

describe('carryOverFields', () => {
  it('copies the item, boss, note and the whole candidate list, and files it under the new phase pointing at the old priority', () => {
    assert.deepEqual(carryOverFields(source, 2), { item: 'Iron Ring', encounter: 'Test Hall \u00b7 Warden', rankedPlayers: ['Aria', 'Brock', 'Aria'], councilNote: 'Healer first', itemId: 101, zoneId: 7, npcId: 10, phaseNo: 2, carriedFrom: 'p1' })
  })
  it('leaves out an id the item does not have (never undefined)', () => {
    const fields = carryOverFields({ id: 'p2', item: 'Typed By Hand', encounter: '', rankedPlayers: [], councilNote: '' }, 1)
    assert.deepEqual(Object.keys(fields).sort(), ['carriedFrom', 'councilNote', 'encounter', 'item', 'phaseNo', 'rankedPlayers'])
    assert.ok(Object.values(fields).every((value) => value !== undefined))
  })
  it('gives the new priority a list of its own, and copies nothing but the fields (no id, revision or stamps)', () => {
    const fields = carryOverFields({ ...source, rev: 4, updatedBy: 'someone' } as typeof source, 1)
    fields.rankedPlayers.push('Cleo')
    assert.deepEqual(source.rankedPlayers, ['Aria', 'Brock', 'Aria'])
    assert.equal('id' in fields || 'rev' in fields || 'updatedBy' in fields, false)
  })
})

describe('onTargetList', () => {
  const target = [{ item: 'Iron Ring', itemId: 101 }, { item: 'Old Cloak' }]
  it('knows an item by its id', () => assert.ok(onTargetList(target, { item: 'Renamed', itemId: 101 })))
  it('knows an item typed by hand by its name, ignoring case and spacing', () => assert.ok(onTargetList(target, { item: '  old   CLOAK ' })))
  it('does not mistake another item for it', () => {
    assert.equal(onTargetList(target, { item: 'New Boots', itemId: 303 }), false)
    assert.equal(onTargetList(target, { item: '' }), false)
  })
})

// What carrying an item over means for "received": the awards of the priority it came from count toward it, nothing else changes.
describe('received marks on a carried-over priority', () => {
  const first = { id: 'p1', item: 'Iron Ring', rankedPlayers: ['Aria', 'Brock'], phaseNo: 0 }
  const second = { id: 'p2', item: 'Iron Ring', rankedPlayers: ['Aria', 'Brock'], phaseNo: 1, carriedFrom: 'p1' }
  const third = { id: 'p3', item: 'Iron Ring', rankedPlayers: ['Aria', 'Brock'], phaseNo: 2, carriedFrom: 'p2' }
  const lookup = priorityLookup([first, second, third])
  const award = (recipient: string, priorityId: string, phaseNo?: number, item = 'Iron Ring') => ({ priorityId, item, recipient, ...(phaseNo !== undefined ? { phaseNo } : {}) })

  it('shows who already got it and who still needs it', () => {
    const received = listingProgress(second, [award('Aria', 'p1', 0)], lookup)
    assert.deepEqual(received.received, [true, false])
    assert.equal(received.next, 1)
  })
  it('leaves the earlier phase as it was when the new phase records an award', () => {
    const awards = [award('Aria', 'p1', 0), award('Brock', 'p2', 1)]
    assert.deepEqual(listingProgress(first, awards, lookup).received, [true, false])
    assert.deepEqual(listingProgress(second, awards, lookup).received, [true, true])
    assert.equal(listingProgress(second, awards, lookup).complete, true)
  })
  it('follows the chain across several phases', () => {
    assert.deepEqual(listingProgress(third, [award('Aria', 'p1', 0), award('Brock', 'p2', 1)], lookup).received, [true, true])
  })
  it('counts an award recorded without a priority in the phase it came from or in a phase it was carried from, and in no other', () => {
    const manual = (phaseNo: number) => award('Aria', '', phaseNo)
    assert.deepEqual(listingProgress(second, [manual(0)], lookup).received, [true, false])
    assert.deepEqual(listingProgress(second, [manual(1)], lookup).received, [true, false])
    assert.deepEqual(listingProgress(second, [manual(2)], lookup).received, [false, false])
    assert.deepEqual(listingProgress(first, [manual(1)], lookup).received, [false, false])
  })
  it('does not count the awards of another priority, or of another item', () => {
    assert.deepEqual(listingProgress(second, [award('Aria', 'elsewhere', 0), award('Aria', '', 0, 'Other Item')], lookup).received, [false, false])
  })
  it('without a lookup, or when the source is gone, only the awards of the priority itself and of the id it names count', () => {
    assert.deepEqual(listingProgress(second, [award('Aria', 'p1', 0)]).received, [true, false])
    assert.deepEqual(awardsForPriority({ ...second, carriedFrom: 'deleted' }, [award('Aria', 'deleted', 0)], lookup).length, 1)
  })
  it('does not loop on a chain that points back at itself, and stops after 20 steps', () => {
    const a = { id: 'a', item: 'X', rankedPlayers: ['Aria'], carriedFrom: 'b' }
    const b = { id: 'b', item: 'X', rankedPlayers: ['Aria'], carriedFrom: 'a' }
    assert.equal(awardsForPriority(a, [award('Aria', 'b'), award('Aria', 'a')], priorityLookup([a, b])).length, 2)
    const long = Array.from({ length: 30 }, (_, index) => ({ id: `c${index}`, item: 'X', rankedPlayers: ['Aria'], phaseNo: index, carriedFrom: index > 0 ? `c${index - 1}` : undefined }))
    const found = awardsForPriority(long[29], long.map((entry) => award('Aria', entry.id)), priorityLookup(long)).map((entry) => entry.priorityId)
    assert.equal(found.length, 21)
    assert.ok(found.includes('c29') && found.includes('c9') && !found.includes('c8'))
  })
})
