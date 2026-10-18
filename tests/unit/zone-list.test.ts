import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { LootTableDoc, ZoneTableDoc } from '../../src/shared/game/guildTables.ts'
import type { LootTableCapture } from '../../src/shared/game/lootTables.ts'
import { listZones, schedulableZones, zoneNameKey } from '../../src/shared/game/zoneList.ts'

// Invented zones.
const capture = (zoneId: number, name: string, kind: 'dungeon' | 'raid' = 'dungeon', players = 5): LootTableCapture => ({
  format: 1, zoneId, name, kind, players, source: 'https://example.test', capturedAt: '2026-10-16', sources: [{ npcId: 1, name: 'Boss', kind: 'boss', itemIds: [1] }], zoneWideItemIds: [],
})
const made = (zoneId: number, phaseNo: number, name: string, kind: 'dungeon' | 'raid', players: number): ZoneTableDoc => ({ id: `z${zoneId}_${phaseNo}`, type: 'zone', zoneId, phaseNo, name, kind, players, rev: 1 })
const captures = [capture(719, 'Alder Hollow'), capture(2437, 'Cinder Vault', 'raid', 20)]

describe('listZones', () => {
  it('lists the zones of the built-in drop lists with no document at all, by name', () => {
    const zones = listZones(captures, [], [], 0)
    assert.deepEqual(zones.map((zone) => [zone.name, zone.source, zone.key, zone.kind, zone.players]), [['Alder Hollow', 'built-in', '719', 'dungeon', 5], ['Cinder Vault', 'built-in', '2437', 'raid', 20]])
    assert.deepEqual(zones.map((zone) => zone.zoneId), [719, 2437])
  })

  it('lists a zone made in Settings, with the zone as the drop lists have it in the phase it was written in (where a rename is written)', () => {
    const zones = listZones(captures, [made(50_000_001, 1, 'Brazen Spire', 'raid', 40)], [], 1)
    const spire = zones.find((zone) => zone.name === 'Brazen Spire')!
    assert.deepEqual([spire.source, spire.key, spire.kind, spire.players, spire.zone?.phaseNo, spire.zone?.custom], ['guild', '50000001', 'raid', 40, 1, true])
  })

  it('lists a zone made for the next phase, and not one made two phases ahead', () => {
    const docs = [made(50_000_001, 2, 'Next Keep', 'raid', 20), made(50_000_002, 3, 'Far Keep', 'raid', 20)]
    const zones = listZones(captures, docs, [], 1)
    assert.ok(zones.some((zone) => zone.name === 'Next Keep' && zone.zone?.phaseNo === 2))
    assert.ok(!zones.some((zone) => zone.name === 'Far Keep'))
  })

  it('a zone made in an earlier phase is the same zone in the current one (its documents are written in the current phase)', () => {
    const zones = listZones(captures, [made(50_000_001, 0, 'Old Keep', 'dungeon', 5)], [], 2)
    const old = zones.find((zone) => zone.name === 'Old Keep')!
    assert.equal(old.zone?.phaseNo, 2)
    assert.equal(zones.filter((zone) => zone.zoneId === 50_000_001).length, 1)
  })

  it('lists a zone of the older raid zone list as a raid of its size, under its own key', () => {
    const zones = listZones([], [], [{ id: 'abc-123', name: 'Molten Test', size: 40 }], 0)
    assert.deepEqual(zones.map((zone) => [zone.name, zone.source, zone.key, zone.kind, zone.players, zone.catalogId, zone.zoneId]), [['Molten Test', 'catalog', 'r-abc-123', 'raid', 40, 'abc-123', undefined]])
  })

  it('puts every kind in one list, by name, and a zone nobody named the same way as another keeps its own place', () => {
    const zones = listZones(captures, [made(50_000_001, 0, 'Bramble Keep', 'dungeon', 5)], [{ id: 'x1', name: 'Aardvark Den', size: 10 }], 0)
    assert.deepEqual(zones.map((zone) => zone.name), ['Aardvark Den', 'Alder Hollow', 'Bramble Keep', 'Cinder Vault'])
  })

  it('does not change what it is given', () => {
    const docs = Object.freeze([Object.freeze(made(50_000_001, 0, 'Frozen Keep', 'raid', 10))]) as unknown as LootTableDoc[]
    const catalog = Object.freeze([Object.freeze({ id: 'x', name: 'X', size: 10 })])
    assert.equal(listZones(captures, docs, catalog, 0).length, 4)
  })
})

describe('schedulableZones', () => {
  it('offers the raids of 10, 20 and 40, from every list, and nothing else', () => {
    const zones = listZones(
      [capture(719, 'Alder Hollow'), capture(2437, 'Cinder Vault', 'raid', 20)],
      [made(50_000_001, 0, 'Brazen Spire', 'raid', 40), made(50_000_002, 0, 'Odd Raid', 'raid', 25), made(50_000_003, 0, 'Big Dungeon', 'dungeon', 10)],
      [{ id: 'abc', name: 'Old Raid', size: 10 }],
      0,
    )
    assert.deepEqual(schedulableZones(zones), [
      { id: 'z50000001', name: 'Brazen Spire', size: 40 },
      { id: 'z2437', name: 'Cinder Vault', size: 20 },
      { id: 'abc', name: 'Old Raid', size: 10 },
    ])
  })

  it('cuts a name over 80 characters, which is as many as a raid keeps', () => {
    const zones = listZones([], [made(50_000_001, 0, 'x'.repeat(100), 'raid', 40)], [], 0)
    assert.equal(zones[0].name.length, 100)
    assert.equal(schedulableZones(zones)[0].name.length, 80)
  })

  it('offers nothing when there is no raid', () => {
    assert.deepEqual(schedulableZones(listZones(captures.slice(0, 1), [], [], 0)), [])
  })
})

describe('zoneNameKey', () => {
  it('ignores case and extra spaces', () => {
    assert.equal(zoneNameKey('  Molten   CORE '), 'molten core')
    assert.equal(zoneNameKey('Molten Core'), zoneNameKey('molten core'))
  })
})
