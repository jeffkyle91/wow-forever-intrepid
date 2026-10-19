import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { carryFiltersActive, carryOverFields, noCarryFilters, onTargetList, targetIndex, visibleForCarryOver } from '../../src/features/loot/carryOver.ts'
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

describe('the filters of the Carry over dialog', () => {
  // Invented items. A dungeon, a middle dot and the boss, as Browse drops writes an encounter; one has none.
  const items = [
    { id: 'a', item: 'Iron Ring', encounter: 'Test Hall \u00b7 Warden', rankedPlayers: ['Aria', 'Brock'], itemId: 1 },
    { id: 'b', item: 'Oak Staff', encounter: 'Test Hall \u00b7 Warden', rankedPlayers: ['Cleo'], itemId: 2 },
    { id: 'c', item: 'Silk Cowl', encounter: 'Test Hall \u00b7 Seer', rankedPlayers: ['Aria'], itemId: 3 },
    { id: 'd', item: 'Brass Key', encounter: 'Sample Cave \u00b7 Warden', rankedPlayers: [], itemId: 4 },
    { id: 'e', item: 'Typed By Hand', encounter: '', rankedPlayers: ['Dara'] },
  ]
  const slots: Record<string, string | undefined> = { a: 'Finger', b: '2H Weapon', c: 'Head', d: undefined, e: 'Other' }
  const slotOf = (priority: { id?: string }) => slots[priority.id ?? '']
  const ids = (filters: Partial<typeof noCarryFilters>) => visibleForCarryOver(items, { ...noCarryFilters, ...filters }, slotOf).map((priority) => priority.id)

  it('lets everything through when no filter is set', () => {
    assert.deepEqual(ids({}), ['a', 'b', 'c', 'd', 'e'])
    assert.equal(carryFiltersActive(noCarryFilters), false)
  })
  it('a whole dungeon, or one boss of it, by its encounter scope (the same scopes as the priority list)', () => {
    assert.deepEqual(ids({ encounter: 'd:test hall' }), ['a', 'b', 'c'])
    assert.deepEqual(ids({ encounter: 'b:test hall|warden' }), ['a', 'b'])
    assert.deepEqual(ids({ encounter: 'b:sample cave|warden' }), ['d'], 'a boss with the same name in another dungeon is a different boss')
    assert.deepEqual(ids({ encounter: 'd:' }), ['e'], 'the priorities with no dungeon')
    assert.deepEqual(ids({ encounter: 'x:nonsense' }), [], 'a scope that is not understood shows nothing')
  })
  it('an item slot, and an item whose slot is not known yet matches no slot until it is', () => {
    assert.deepEqual(ids({ slot: 'Head' }), ['c'])
    assert.deepEqual(ids({ slot: 'Other' }), ['e'])
    assert.deepEqual(ids({ slot: 'Finger' }), ['a'])
    assert.deepEqual(ids({ slot: 'Trinket' }), [])
  })
  it('the search looks at the item, the dungeon and boss, and the players, ignoring case and spaces around it', () => {
    assert.deepEqual(ids({ text: '  OAK ' }), ['b'])
    assert.deepEqual(ids({ text: 'sample' }), ['d'])
    assert.deepEqual(ids({ text: 'aria' }), ['a', 'c'])
    assert.deepEqual(ids({ text: 'warden' }), ['a', 'b', 'd'])
  })
  it('the filters work together: each one narrows what the others let through', () => {
    assert.deepEqual(ids({ encounter: 'd:test hall', text: 'aria' }), ['a', 'c'])
    assert.deepEqual(ids({ encounter: 'd:test hall', text: 'aria', slot: 'Head' }), ['c'])
    assert.deepEqual(ids({ encounter: 'b:test hall|seer', slot: 'Finger' }), [])
  })
  it('never changes the list it is given, and keeps its order', () => {
    const before = JSON.stringify(items)
    visibleForCarryOver(items, { text: 'a', encounter: '', slot: '' }, slotOf)
    assert.equal(JSON.stringify(items), before)
    assert.deepEqual(ids({ text: 'a' }), ['a', 'b', 'c', 'd', 'e'])
  })
  it('knows when a filter is active, a search of only spaces not counting', () => {
    assert.equal(carryFiltersActive({ text: '   ', encounter: '', slot: '' }), false)
    assert.equal(carryFiltersActive({ text: 'x', encounter: '', slot: '' }), true)
    assert.equal(carryFiltersActive({ text: '', encounter: 'd:test hall', slot: '' }), true)
    assert.equal(carryFiltersActive({ text: '', encounter: '', slot: 'Head' }), true)
  })
})

describe('targetIndex', () => {
  const target = [{ item: 'Iron Ring', itemId: 101 }, { item: 'Typed By Hand' }, { item: '  Spaced   Name ' }, { item: '' }]
  const sources = [
    { item: 'Anything', itemId: 101 }, { item: 'Iron Ring' }, { item: 'iron ring', itemId: 999 }, { item: 'typed by hand' }, { item: 'spaced name' }, { item: 'Other', itemId: 7 },
    { item: '' }, { item: '   ' }, { item: 'Nothing', itemId: undefined },
  ]
  it('answers exactly what onTargetList answers, for every kind of item (same id, same name for one typed by hand, blank names never match)', () => {
    const on = targetIndex(target)
    for (const source of sources) assert.equal(on(source), onTargetList(target, source), JSON.stringify(source))
    assert.equal(on({ item: 'Anything', itemId: 101 }), true)
    assert.equal(on({ item: 'Other', itemId: 7 }), false)
    assert.equal(on({ item: '' }), false)
  })
  it('an empty target list has nothing on it', () => {
    assert.equal(targetIndex([])({ item: 'Iron Ring', itemId: 101 }), false)
  })
})
