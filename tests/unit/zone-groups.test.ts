import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groupZones, openGroupKeys, zonesStartOpen } from '../../src/shared/game/zoneGroups.ts'

// Invented zones.
const zone = (name: string, kind: 'dungeon' | 'raid', players: number, inPhase = false) => ({ name, kind, players, inPhase })
const names = (groups: ReturnType<typeof groupZones<ReturnType<typeof zone>>>) => groups.map((group) => [group.label, group.zones.map((entry) => entry.name)])

describe('groupZones', () => {
  it('gives nothing for no zones', () => {
    assert.deepEqual(groupZones([]), [])
  })

  it('lists only the groups that have a zone: no raids, no raid groups', () => {
    const groups = groupZones([zone('Alder Hollow', 'dungeon', 5), zone('Bramble Keep', 'dungeon', 5)])
    assert.deepEqual(groups.map((group) => group.key), ['dungeon'])
    assert.deepEqual(names(groups), [['Dungeons', ['Alder Hollow', 'Bramble Keep']]])
  })

  it('no dungeons: the dungeon group is not there', () => {
    assert.deepEqual(groupZones([zone('Cinder Vault', 'raid', 40)]).map((group) => group.label), ['40-man raids'])
  })

  it('puts dungeons first, then raids from the smallest size up, whatever order the zones came in', () => {
    const groups = groupZones([zone('Vault', 'raid', 40), zone('Hollow', 'dungeon', 5), zone('Spire', 'raid', 20), zone('Den', 'raid', 10), zone('Keep', 'raid', 40), zone('Mine', 'dungeon', 5)])
    assert.deepEqual(names(groups), [['Dungeons', ['Hollow', 'Mine']], ['10-man raids', ['Den']], ['20-man raids', ['Spire']], ['40-man raids', ['Vault', 'Keep']]])
    assert.deepEqual(groups.map((group) => group.key), ['dungeon', 'raid-10', 'raid-20', 'raid-40'])
  })

  it('orders raids by their size as a number, so a 5-man raid comes before a 10-man raid and a 100-man raid after a 40-man one', () => {
    const groups = groupZones([zone('Hundred', 'raid', 100), zone('Forty', 'raid', 40), zone('Five', 'raid', 5), zone('Ten', 'raid', 10), zone('Dungeon', 'dungeon', 5)])
    assert.deepEqual(groups.map((group) => group.key), ['dungeon', 'raid-5', 'raid-10', 'raid-40', 'raid-100'])
    assert.deepEqual(groups.map((group) => group.label), ['Dungeons', '5-man raids', '10-man raids', '40-man raids', '100-man raids'])
  })

  it('keeps the order the zones were given inside a group', () => {
    const groups = groupZones([zone('C', 'dungeon', 5), zone('A', 'dungeon', 5), zone('B', 'dungeon', 5)])
    assert.deepEqual(groups[0].zones.map((entry) => entry.name), ['C', 'A', 'B'])
  })

  it('a dungeon is a dungeon whatever its size, and a raid of a size nobody expected has its own group in its place', () => {
    const groups = groupZones([zone('Big Dungeon', 'dungeon', 10), zone('Small Dungeon', 'dungeon', 5), zone('Odd Raid', 'raid', 25), zone('Ten', 'raid', 10), zone('Forty', 'raid', 40)])
    assert.deepEqual(groups.map((group) => group.label), ['Dungeons', '10-man raids', '25-man raids', '40-man raids'])
    assert.deepEqual(groups[0].zones.map((entry) => entry.name), ['Big Dungeon', 'Small Dungeon'])
  })

  it('does not change what it is given (the zones themselves included) and uses every zone once', () => {
    const given = Object.freeze([zone('A', 'raid', 20), zone('B', 'dungeon', 5), zone('C', 'raid', 10)].map((entry) => Object.freeze(entry)))
    const groups = groupZones(given)
    assert.equal(groups.flatMap((group) => group.zones).length, given.length)
    assert.deepEqual(given.map((entry) => entry.name), ['A', 'B', 'C'])
  })

  it('a kind it does not know is a dungeon, and a size that is not a number reads as 0', () => {
    assert.deepEqual(groupZones([{ kind: 'zone', players: 5 }]).map((group) => group.key), ['dungeon'])
    assert.deepEqual(groupZones([{ kind: 'raid', players: Number.NaN }]).map((group) => group.label), ['0-man raids'])
  })
})

describe('openGroupKeys', () => {
  const inLists = (entry: { inPhase: boolean }) => entry.inPhase

  it('the only group is open', () => {
    assert.deepEqual([...openGroupKeys(groupZones([zone('A', 'dungeon', 5)]), inLists)], ['dungeon'])
  })

  it('opens the groups that have a zone in the lists and closes the others', () => {
    const groups = groupZones([zone('A', 'dungeon', 5), zone('B', 'raid', 10, true), zone('C', 'raid', 40), zone('D', 'raid', 40, true)])
    assert.deepEqual([...openGroupKeys(groups, inLists)].sort(), ['raid-10', 'raid-40'])
  })

  it('opens the first group when none has a zone in the lists', () => {
    const groups = groupZones([zone('A', 'dungeon', 5), zone('B', 'raid', 40)])
    assert.deepEqual([...openGroupKeys(groups, inLists)], ['dungeon'])
  })

  it('has nothing to open when there are no groups', () => {
    assert.equal(openGroupKeys<ReturnType<typeof zone>>([], inLists).size, 0)
  })
})

describe('zonesStartOpen', () => {
  it('the Zones section starts open only for a phase with nothing set up: no zone in its lists and no phase followed', () => {
    assert.equal(zonesStartOpen(0, false), true)
    assert.equal(zonesStartOpen(3, false), false)
    assert.equal(zonesStartOpen(0, true), false)
    assert.equal(zonesStartOpen(9, true), false)
  })
})
