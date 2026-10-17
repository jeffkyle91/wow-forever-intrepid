import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { checkLootCapture, lootCaptureItemIds, lootItemsOfNpc, lootSourceOfItem } from '../../src/shared/game/lootTables.ts'

const deadmines = JSON.parse(readFileSync(new URL('../../data/loot/the-deadmines.json', import.meta.url), 'utf8'))
// A small valid capture to break one thing at a time. Every name is invented or a public game name.
const valid = () => ({ format: 1, zoneId: 1, name: 'Test Hall', kind: 'dungeon', players: 5, source: 'https://example.test/zone=1', capturedAt: '2026-10-16', sources: [{ npcId: 10, name: 'Boss One', kind: 'boss', itemIds: [100, 101] }, { npcId: 11, name: 'A Rat', kind: 'trash', itemIds: [200] }], zoneWideItemIds: [300] })
const errorsOf = (data: unknown) => { const result = checkLootCapture(data); return result.ok ? [] : result.errors }

describe('the Deadmines capture in the repository', () => {
  it('is valid', () => assert.deepEqual(errorsOf(deadmines), []))
  it('has 44 distinct items, 9 sources of rare or boss kind and 4 zone-wide items', () => {
    const result = checkLootCapture(deadmines)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(lootCaptureItemIds(result.table).length, 44)
      assert.equal(result.table.sources.filter((source) => source.kind !== 'trash').length, 9)
      assert.equal(result.table.zoneWideItemIds.length, 4)
    }
  })
})

describe('checkLootCapture', () => {
  it('accepts a valid capture', () => assert.deepEqual(errorsOf(valid()), []))
  it('refuses anything that is not an object', () => { assert.equal(errorsOf(null).length, 1); assert.equal(errorsOf('x').length, 1) })
  it('reports every problem, not only the first', () => assert.ok(errorsOf({ ...valid(), format: 2, name: '', kind: 'cave' }).length >= 3))
  it('refuses an item listed twice, in two sources or in a source and zone-wide', () => {
    const twice = valid(); twice.sources[1].itemIds = [100]
    assert.match(errorsOf(twice).join(' '), /item 100 appears in source 1 \(Boss One\) and in source 2/)
    const zone = valid(); zone.zoneWideItemIds = [101]
    assert.match(errorsOf(zone).join(' '), /item 101 appears/)
  })
  it('refuses a bad creature kind, an empty or non-numeric item list, and a bad id', () => {
    const bad = valid(); bad.sources[0].kind = 'elite'; bad.sources[1].itemIds = []
    assert.equal(errorsOf(bad).length, 2)
    const ids = valid(); ids.sources[0].itemIds = [100, 1.5, -2, '7'] as unknown as number[]
    assert.equal(errorsOf(ids).length, 1)
  })
  it('refuses a missing sources list, a bad date and more than 40 players', () => {
    const noSources = valid() as Record<string, unknown>; delete noSources.sources
    assert.match(errorsOf(noSources).join(' '), /sources must be a list/)
    assert.match(errorsOf({ ...valid(), capturedAt: 'yesterday' }).join(' '), /capturedAt/)
    assert.match(errorsOf({ ...valid(), players: 41 }).join(' '), /players/)
  })
})

describe('lookups', () => {
  const table = (() => { const result = checkLootCapture(valid()); if (!result.ok) throw new Error('fixture is invalid'); return result.table })()
  it('lists every distinct item once', () => assert.deepEqual(lootCaptureItemIds(table), [100, 101, 200, 300]))
  it('finds the creature that drops an item', () => {
    assert.equal(lootSourceOfItem(table, 101)?.name, 'Boss One')
    assert.equal(lootSourceOfItem(table, 300), undefined)
    assert.equal(lootSourceOfItem(table, 999), undefined)
  })
  it('finds the items of a creature by its NPC id', () => {
    assert.deepEqual(lootItemsOfNpc(table, 10), [100, 101])
    assert.deepEqual(lootItemsOfNpc(table, 12345), [])
  })
})
