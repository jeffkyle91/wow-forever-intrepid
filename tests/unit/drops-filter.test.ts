import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { countItems, dropEncounter, dropPriorityId, dropPriorityRecord, filterGroups, prioritiesForItem, zoneWideName } from '../../src/features/loot/dropsFilter.ts'

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
  it('has one fixed id per item in a phase, so an item can be on a phase\'s list only once', () => {
    assert.equal(dropPriorityId(872), 'drop-872')
    assert.equal(dropPriorityId(872, 0), 'drop-872')
    assert.equal(dropPriorityId(872), dropPriorityId(872))
    assert.match(dropPriorityId(273289), /^[A-Za-z0-9_-]{1,100}$/)
  })
  it('gives the same item a different id in every phase, so it can be on each phase\'s list', () => {
    assert.equal(dropPriorityId(872, 2), 'drop-872-p2')
    assert.equal(new Set([0, 1, 2, 3].map((phase) => dropPriorityId(872, phase))).size, 4)
    assert.match(dropPriorityId(273289, 30), /^[A-Za-z0-9_-]{1,100}$/)
  })
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
