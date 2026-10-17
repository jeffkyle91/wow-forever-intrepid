import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { countItems, filterGroups, zoneWideName } from '../../src/features/loot/dropsFilter.ts'

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
