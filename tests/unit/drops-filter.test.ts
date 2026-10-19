import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { countItems, dropEncounter, dropFiltersActive, dropPriorityRecord, filterGroups, noDropFilters, prioritiesForItem, zoneWideName } from '../../src/features/loot/dropsFilter.ts'

// Invented creatures and items.
const table = {
  sources: [
    { npcId: 10, name: 'Hall Warden', kind: 'boss', itemIds: [100, 101] },
    { npcId: 11, name: 'Cave Rat', kind: 'trash', itemIds: [200] },
    { npcId: 12, name: 'Old Mossback', kind: 'rare', itemIds: [300, 301] },
  ],
  zoneWideItemIds: [900, 901],
}
const names: Record<number, string> = { 100: 'Warden Blade', 101: 'Iron Ring', 200: 'Rat Tail', 300: 'Moss Cloak', 301: 'Ring of Moss', 900: 'Plain Boots', 901: 'Cave Lantern' }
const nameOf = (id: number): string | undefined => names[id]
const keys = (query: string, lookup = nameOf) => filterGroups(table, query, lookup).map((group) => group.key)

describe('filterGroups', () => {
  it('shows every creature and the zone-wide items for an empty search', () => {
    const groups = filterGroups(table, '', nameOf)
    assert.deepEqual(groups.map((group) => group.key), ['npc-10', 'npc-11', 'npc-12', 'zone-wide'])
    assert.equal(countItems(groups), 7)
    assert.equal(groups.at(-1)?.name, zoneWideName)
    assert.equal(groups.at(-1)?.kind, 'zone')
  })
  it('treats a blank search like an empty one', () => assert.equal(keys('   ').length, 4))
  it('shows all the items of a creature whose name matches, ignoring case', () => {
    const groups = filterGroups(table, 'WARDEN', nameOf)
    assert.deepEqual(groups.map((group) => [group.key, group.itemIds]), [['npc-10', [100, 101]]])
  })
  it('matches a creature kind', () => assert.deepEqual(keys('rare'), ['npc-12']))
  it('shows only the matching items when the creature itself does not match', () => {
    const groups = filterGroups(table, 'ring', nameOf)
    assert.deepEqual(groups.map((group) => [group.key, group.itemIds]), [['npc-10', [101]], ['npc-12', [301]]])
  })
  it('matches an item id', () => assert.deepEqual(filterGroups(table, '301', nameOf).map((group) => [group.key, group.itemIds]), [['npc-12', [301]]]))
  it('finds zone-wide items by name, and the whole group by its label', () => {
    assert.deepEqual(filterGroups(table, 'lantern', nameOf).map((group) => [group.key, group.itemIds]), [['zone-wide', [901]]])
    assert.equal(filterGroups(table, 'any creature', nameOf).at(-1)?.itemIds.length, 2)
  })
  it('still matches ids and creatures while item names have not loaded yet', () => {
    assert.deepEqual(keys('ring', () => undefined), [])
    assert.deepEqual(keys('300', () => undefined), ['npc-12'])
    assert.deepEqual(keys('mossback', () => undefined), ['npc-12'])
  })
  it('leaves out groups with nothing to show', () => assert.deepEqual(keys('no such thing'), []))
  it('does not change the table it reads', () => {
    const before = JSON.stringify(table)
    filterGroups(table, 'ring', nameOf)
    assert.equal(JSON.stringify(table), before)
  })
})

describe('priorities made from drops', () => {
  it('writes the dungeon and boss in the same form as a priority typed by hand', () => {
    assert.equal(dropEncounter('Test Hall', { kind: 'boss', name: 'Hall Warden' }), 'Test Hall \u00b7 Hall Warden')
    assert.equal(dropEncounter('Test Hall', { kind: 'zone', name: 'Any creature in the zone' }), 'Test Hall \u00b7 any creature')
  })
  it('starts with nobody assigned, and carries the item, dungeon and creature', () => {
    const record = dropPriorityRecord({ itemId: 101, zoneId: 7, npcId: 10, encounter: 'Test Hall \u00b7 Hall Warden' }, 'Iron Ring')
    assert.deepEqual(record, { item: 'Iron Ring', encounter: 'Test Hall \u00b7 Hall Warden', rankedPlayers: [], councilNote: '', itemId: 101, zoneId: 7, npcId: 10, phaseNo: 0 })
  })
  it('belongs to the phase it was made for', () => {
    assert.equal(dropPriorityRecord({ itemId: 101, zoneId: 7, encounter: 'x' }, 'Iron Ring', 3).phaseNo, 3)
  })
  it('leaves npcId out, never undefined, for an item from any creature in the zone', () => {
    const record = dropPriorityRecord({ itemId: 900, zoneId: 7, encounter: 'Test Hall \u00b7 any creature' }, 'Plain Boots')
    assert.equal('npcId' in record, false)
    assert.ok(Object.values(record).every((value) => value !== undefined))
  })
  it('gives every record its own empty candidate list', () => {
    const a = dropPriorityRecord({ itemId: 1, zoneId: 1, encounter: 'x' }, 'A')
    const b = dropPriorityRecord({ itemId: 2, zoneId: 1, encounter: 'x' }, 'B')
    a.rankedPlayers.push('someone')
    assert.deepEqual(b.rankedPlayers, [])
  })
})

describe('prioritiesForItem', () => {
  const priorities = [
    { id: 'drop-101', item: 'Iron Ring', itemId: 101 },
    { id: 'typed-1', item: '  iron   RING ' },
    { id: 'typed-2', item: 'Moss Cloak' },
    { id: 'drop-300', item: 'Moss Cloak', itemId: 300 },
    { id: 'blank', item: '' },
  ]
  const ids = (found: { id: string }[]) => found.map((priority) => priority.id)
  it('finds the priority that carries the id', () => assert.deepEqual(ids(prioritiesForItem(priorities, 101)), ['drop-101']))
  it('also finds one typed by hand with the same name, ignoring case and extra spaces', () => assert.deepEqual(ids(prioritiesForItem(priorities, 101, 'Iron Ring')), ['drop-101', 'typed-1']))
  it('finds every priority that stands for the item, so removing it takes them all off', () => assert.deepEqual(ids(prioritiesForItem(priorities, 300, 'Moss Cloak')), ['typed-2', 'drop-300']))
  it('finds nothing for an item that is not on the list', () => assert.deepEqual(prioritiesForItem(priorities, 999, 'Plain Boots'), []))
  it('does not match by name when the name is not known yet, and never matches a blank name', () => {
    assert.deepEqual(prioritiesForItem(priorities, 999), [])
    assert.deepEqual(prioritiesForItem(priorities, 999, ''), [])
    assert.deepEqual(prioritiesForItem(priorities, 999, '   '), [])
  })
  it('does not match an id on a different item just because the name differs in spelling', () => assert.deepEqual(prioritiesForItem(priorities, 101, 'Iron Rings'), ['drop-101'].map((id) => priorities.find((priority) => priority.id === id))))
  it('does not change its input', () => {
    const before = JSON.stringify(priorities)
    prioritiesForItem(priorities, 101, 'Iron Ring')
    assert.equal(JSON.stringify(priorities), before)
  })
})

describe('filterGroups for creatures the guild added', () => {
  const table = { sources: [{ npcId: 0, name: 'First Add', kind: 'boss', itemIds: [1] }, { npcId: 0, name: 'Second Add', kind: 'rare', itemIds: [2] }, { npcId: 77, name: 'Known', kind: 'boss', itemIds: [3] }], zoneWideItemIds: [] }
  it('gives a creature with no number its own key and no creature number, so two of them never share a group or a priority id', () => {
    const groups = filterGroups(table, '', () => undefined)
    assert.deepEqual(groups.map((group) => group.key), ['creature-0', 'creature-1', 'npc-77'])
    assert.deepEqual(groups.map((group) => group.npcId), [undefined, undefined, 77])
    assert.ok(!('npcId' in groups[0]))
  })
})

describe('the filters of Browse drops (one creature, an item slot)', () => {
  const slots: Record<number, string | undefined> = { 100: '1H Weapon', 101: 'Finger', 200: 'Other', 300: 'Back', 301: 'Finger', 900: 'Feet', 901: undefined }
  const slotOf = (id: number) => slots[id]
  const shown = (query: string, filters: Partial<typeof noDropFilters>) => filterGroups(table, query, nameOf, { ...noDropFilters, ...filters }, slotOf).map((group) => [group.key, group.itemIds])

  it('shows everything when no filter is set, like before', () => {
    assert.deepEqual(shown('', {}).map(([key]) => key), ['npc-10', 'npc-11', 'npc-12', 'zone-wide'])
    assert.equal(dropFiltersActive(noDropFilters, ''), false)
  })
  it('one creature, by its group key, including the zone-wide group', () => {
    assert.deepEqual(shown('', { creature: 'npc-12' }), [['npc-12', [300, 301]]])
    assert.deepEqual(shown('', { creature: 'zone-wide' }), [['zone-wide', [900, 901]]])
    assert.deepEqual(shown('', { creature: 'npc-404' }), [], 'a creature that is not in the zone shows nothing')
  })
  it('an item slot keeps only the items in it and drops the creatures left with none; an item whose slot is not known yet matches no slot', () => {
    assert.deepEqual(shown('', { slot: 'Finger' }), [['npc-10', [101]], ['npc-12', [301]]])
    assert.deepEqual(shown('', { slot: 'Feet' }), [['zone-wide', [900]]])
    assert.deepEqual(shown('', { slot: 'Other' }), [['npc-11', [200]]])
    assert.deepEqual(shown('', { slot: 'Trinket' }), [])
  })
  it('the creature, the slot and the search narrow each other', () => {
    assert.deepEqual(shown('', { creature: 'npc-12', slot: 'Finger' }), [['npc-12', [301]]])
    assert.deepEqual(shown('ring', { slot: 'Finger' }), [['npc-10', [101]], ['npc-12', [301]]])
    assert.deepEqual(shown('moss', { slot: 'Back' }), [['npc-12', [300]]], 'a creature whose name matches still shows only the items of the slot')
    assert.deepEqual(shown('ring', { creature: 'npc-10', slot: 'Back' }), [])
  })
  it('knows when anything narrows the list, a search of only spaces not counting', () => {
    assert.equal(dropFiltersActive(noDropFilters, '   '), false)
    assert.equal(dropFiltersActive(noDropFilters, 'x'), true)
    assert.equal(dropFiltersActive({ creature: 'npc-10', slot: '' }, ''), true)
    assert.equal(dropFiltersActive({ creature: '', slot: 'Head' }, ''), true)
  })
  it('does not change the table it is given', () => {
    const before = JSON.stringify(table)
    shown('ring', { slot: 'Finger', creature: 'npc-10' })
    assert.equal(JSON.stringify(table), before)
  })
})
