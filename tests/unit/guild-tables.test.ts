import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CUSTOM_ZONE_MIN, describePreparedTables, hasText, resetCreature, resetZone, TABLE_ITEMS_MAX, ZONE_WIDE_KEY, addCreature, addItems, addZone, builtInKey, dropTablesOf, editZone, firstPhases, itemHolders, mergeTables, moveCreature,
  newCreatureKey, newZoneId, parseItemIds, readTableDoc, renameCreature, restoreItem, setCreatureRemoved, setZoneInPhase, sourceDocId, takeOffItem, zoneDocId,
  type LootTableDoc, type SourceTableDoc, type ZoneTableDoc,
} from '../../src/shared/game/guildTables.ts'
import type { LootTableCapture } from '../../src/shared/game/lootTables.ts'

// Invented zones, creatures and item numbers.
const capture: LootTableCapture = {
  format: 1, zoneId: 900, name: 'Test Hollow', kind: 'dungeon', players: 5, source: 'https://example.test/zone=900', capturedAt: '2026-10-16',
  sources: [
    { npcId: 11, name: 'First Warden', kind: 'boss', itemIds: [101, 102, 103] },
    { npcId: 12, name: 'Second Warden', kind: 'boss', itemIds: [201, 202] },
    { npcId: 13, name: 'Rare Hound', kind: 'rare', itemIds: [301] },
  ],
  zoneWideItemIds: [901, 902],
}
const other: LootTableCapture = { ...capture, zoneId: 800, name: 'Another Cave', sources: [{ npcId: 21, name: 'Cave Boss', kind: 'boss', itemIds: [501] }], zoneWideItemIds: [] }
const LAIR = CUSTOM_ZONE_MIN + 1

// A creature document of `phaseNo`. A delta: `itemIds` added in that phase, `hiddenItemIds` taken off from it on.
// A document says only what it sets: no name, kind, place or number unless the test gives one.
const source = (zoneId: number, key: string, phaseNo: number, fields: Partial<SourceTableDoc> = {}): SourceTableDoc => ({
  id: sourceDocId(zoneId, key, phaseNo), type: 'source', zoneId, key, phaseNo, itemIds: [], hiddenItemIds: [], rev: 1, ...fields,
})
const overlay = (npc: string, phaseNo: number, fields: Partial<SourceTableDoc> = {}) => source(900, builtInKey(Number(npc)), phaseNo, fields)
const zoneDoc = (zoneId: number, phaseNo: number, fields: Partial<ZoneTableDoc> = {}): ZoneTableDoc => ({ id: zoneDocId(zoneId, phaseNo), type: 'zone', zoneId, phaseNo, name: 'Guild Lair', kind: 'raid', players: 25, rev: 1, ...fields })
const presence = (zoneId: number, phaseNo: number, removed: boolean): ZoneTableDoc => ({ id: zoneDocId(zoneId, phaseNo), type: 'zone', zoneId, phaseNo, removed, rev: 1 })

const zoneOf = (docs: LootTableDoc[], phaseNo: number, zoneId = 900) => mergeTables([capture, other], docs, phaseNo).find((zone) => zone.zoneId === zoneId)!
const sourceOf = (docs: LootTableDoc[], phaseNo: number, key: string, zoneId = 900) => zoneOf(docs, phaseNo, zoneId).sources.find((candidate) => candidate.key === key)!
const items = (docs: LootTableDoc[], phaseNo: number, key = builtInKey(11)) => sourceOf(docs, phaseNo, key).itemIds

describe('mergeTables with no documents', () => {
  it('is the built-in captures in name order in every phase, nothing edited', () => {
    for (const phaseNo of [0, 1, 5]) {
      const zones = mergeTables([capture, other], [], phaseNo)
      assert.deepEqual(zones.map((zone) => zone.name), ['Another Cave', 'Test Hollow'])
      assert.ok(zones.every((zone) => !zone.custom && zone.inPhase && !zone.edited && zone.phaseNo === phaseNo))
    }
    assert.deepEqual(zoneOf([], 1).sources.map((entry) => [entry.key, entry.name, entry.itemIds]), [[builtInKey(11), 'First Warden', [101, 102, 103]], [builtInKey(12), 'Second Warden', [201, 202]], [builtInKey(13), 'Rare Hound', [301]]])
    assert.deepEqual(zoneOf([], 1).zoneWide.itemIds, [901, 902])
  })

  it('gives back the capture itself through dropTablesOf, with nothing marked edited or custom', () => {
    const tables = dropTablesOf([capture], [], 2)
    assert.deepEqual(tables[0].sources, capture.sources)
    assert.deepEqual(tables[0].zoneWideItemIds, capture.zoneWideItemIds)
    assert.equal(tables[0].custom, false)
    assert.equal(tables[0].edited, false)
  })
})

describe('items follow the phases', () => {
  it('an item added in phase 1 is there in phase 1 and after, and not before', () => {
    const docs = [overlay('11', 1, { itemIds: [104] })]
    assert.deepEqual(items(docs, 0), [101, 102, 103])
    assert.deepEqual(items(docs, 1), [101, 102, 103, 104])
    assert.deepEqual(items(docs, 2), [101, 102, 103, 104])
    assert.deepEqual(items(docs, 9), [101, 102, 103, 104])
  })

  it('a phase with no documents is the same as the one before it, and a later phase can differ', () => {
    const docs = [overlay('11', 1, { itemIds: [104] }), overlay('11', 3, { hiddenItemIds: [102, 104] })]
    assert.deepEqual(items(docs, 2), items(docs, 1))
    assert.deepEqual(items(docs, 3), [101, 103])
    assert.deepEqual(items(docs, 4), [101, 103])
    assert.deepEqual(items(docs, 1), [101, 102, 103, 104]) // the earlier phase keeps its list
  })

  it('an item taken off in a phase can be added again in a later one, and goes to the end', () => {
    const docs = [overlay('11', 2, { hiddenItemIds: [102] }), overlay('11', 3, { itemIds: [102] })]
    assert.deepEqual(items(docs, 1), [101, 102, 103])
    assert.deepEqual(items(docs, 2), [101, 103])
    assert.deepEqual(items(docs, 3), [101, 103, 102])
  })

  it('an item a document both takes off and adds is there afterwards; one it takes off that was never there, or adds that already is, changes nothing', () => {
    assert.deepEqual(items([overlay('11', 1, { hiddenItemIds: [102], itemIds: [102] })], 1), [101, 103, 102])
    assert.deepEqual(items([overlay('11', 1, { hiddenItemIds: [999], itemIds: [101, 104, 104] })], 1), [101, 102, 103, 104])
  })

  it('at the phase itself it reports what that phase added and took off, before it, and the document', () => {
    const docs = [overlay('11', 1, { itemIds: [104] }), overlay('11', 2, { itemIds: [105], hiddenItemIds: [101, 999] })]
    const merged = sourceOf(docs, 2, builtInKey(11))
    assert.deepEqual(merged.beforeItemIds, [101, 102, 103, 104])
    assert.deepEqual(merged.addedItemIds, [105])
    assert.deepEqual(merged.hiddenItemIds, [101])
    assert.deepEqual(merged.itemIds, [102, 103, 104, 105])
    assert.equal(merged.doc?.phaseNo, 2)
    const later = sourceOf(docs, 3, builtInKey(11))
    assert.equal(later.doc, undefined)
    assert.deepEqual(later.addedItemIds, [])
    assert.deepEqual(later.beforeItemIds, [102, 103, 104, 105])
    assert.equal(later.docId, sourceDocId(900, builtInKey(11), 3))
  })

  it('documents of later phases never show in an earlier phase', () => {
    const docs = [overlay('12', 4, { itemIds: [204] })]
    assert.deepEqual(items(docs, 3, builtInKey(12)), [201, 202])
    assert.deepEqual(items(docs, 4, builtInKey(12)), [201, 202, 204])
  })

  it('the zone-wide list and the other creatures and zones are independent', () => {
    const wide = source(900, ZONE_WIDE_KEY, 2, { name: 'Any creature in the zone', kind: 'zonewide', itemIds: [903], hiddenItemIds: [901] })
    assert.deepEqual(zoneOf([wide], 1).zoneWide.itemIds, [901, 902])
    assert.deepEqual(zoneOf([wide], 2).zoneWide.itemIds, [902, 903])
    assert.deepEqual(dropTablesOf([capture], [wide], 2)[0].zoneWideItemIds, [902, 903])
    assert.deepEqual(items([overlay('11', 1, { itemIds: [104] })], 1, builtInKey(12)), [201, 202])
    assert.deepEqual(zoneOf([overlay('11', 1, { itemIds: [104] })], 1, 800).sources[0].itemIds, [501])
  })
})

describe('creatures follow the phases', () => {
  it('a creature the guild added does not exist before its first document, and is met after the built-in ones unless given a place', () => {
    const added = source(900, 'cabc', 2, { name: 'New Add', order: 40, itemIds: [700] })
    assert.equal(zoneOf([added], 1).sources.some((entry) => entry.key === 'cabc'), false)
    assert.deepEqual(zoneOf([added], 2).sources.map((entry) => entry.name), ['First Warden', 'Second Warden', 'Rare Hound', 'New Add'])
    const early = source(900, 'cabc', 2, { name: 'New Add', order: 15, itemIds: [700] })
    assert.deepEqual(zoneOf([early], 3).sources.map((entry) => entry.name), ['First Warden', 'New Add', 'Second Warden', 'Rare Hound'])
  })

  it('its name, kind and order come from the latest document, and its items add up across documents', () => {
    const docs = [source(900, 'cabc', 2, { name: 'New Add', kind: 'rare', order: 40, itemIds: [700] }), source(900, 'cabc', 4, { name: 'Renamed Add', kind: 'boss', order: 5, itemIds: [701], hiddenItemIds: [700] })]
    assert.deepEqual([sourceOf(docs, 3, 'cabc').name, sourceOf(docs, 3, 'cabc').kind, sourceOf(docs, 3, 'cabc').itemIds], ['New Add', 'rare', [700]])
    assert.deepEqual([sourceOf(docs, 4, 'cabc').name, sourceOf(docs, 4, 'cabc').kind, sourceOf(docs, 4, 'cabc').order, sourceOf(docs, 4, 'cabc').itemIds], ['Renamed Add', 'boss', 5, [701]])
    assert.equal(zoneOf(docs, 4).sources[0].key, 'cabc')
  })

  it('a creature taken out in one phase is out from there, until a later document brings it back; its items are kept', () => {
    const docs = [source(900, 'cabc', 1, { name: 'Gone', order: 40, itemIds: [700] }), source(900, 'cabc', 2, { name: 'Gone', order: 40, removed: true }), source(900, 'cabc', 4, { name: 'Gone', order: 40, removed: false })]
    assert.equal(sourceOf(docs, 1, 'cabc').removed, false)
    assert.equal(sourceOf(docs, 2, 'cabc').removed, true)
    assert.equal(sourceOf(docs, 3, 'cabc').removed, true)
    assert.equal(sourceOf(docs, 4, 'cabc').removed, false)
    assert.deepEqual(sourceOf(docs, 4, 'cabc').itemIds, [700])
    assert.deepEqual(dropTablesOf([capture], docs, 3)[0].sources.map((entry) => entry.name), ['First Warden', 'Second Warden', 'Rare Hound'])
    assert.deepEqual(dropTablesOf([capture], docs, 4)[0].sources.map((entry) => entry.name), ['First Warden', 'Second Warden', 'Rare Hound', 'Gone'])
  })

  it('a document with no removed field says nothing about presence', () => {
    const docs = [source(900, 'cabc', 1, { name: 'Gone', order: 40, itemIds: [700], removed: true }), source(900, 'cabc', 2, { name: 'Gone', order: 40, itemIds: [701] })]
    assert.equal(sourceOf(docs, 2, 'cabc').removed, true)
    assert.deepEqual(sourceOf(docs, 2, 'cabc').itemIds, [700, 701])
  })

  it('a creature with no items is out of Browse drops but stays for the editor, a new place from a document applies, and a name on a creature of a capture does not', () => {
    const empty = source(900, 'cdef', 1, { name: 'Empty', order: 50 })
    assert.equal(zoneOf([empty], 1).sources.at(-1)?.name, 'Empty')
    assert.deepEqual(dropTablesOf([capture], [empty], 1)[0].sources.map((entry) => entry.name), ['First Warden', 'Second Warden', 'Rare Hound'])
    const moved = overlay('13', 1, { name: 'Rare Hound (the real one)', kind: 'rare', order: 5 })
    assert.deepEqual(zoneOf([moved], 1).sources.map((entry) => entry.name), ['Rare Hound', 'First Warden', 'Second Warden']) // moved up, not renamed
  })

  it('the creature number of a creature the guild added comes from its latest document that has one; a creature of a capture keeps the capture\'s', () => {
    assert.equal(sourceOf([overlay('11', 1, { npcId: 99 })], 1, builtInKey(11)).npcId, 11)
    const added = [source(900, 'cabc', 1, { name: 'A', npcId: 5 }), source(900, 'cabc', 2, { itemIds: [1] }), source(900, 'cabc', 3, { npcId: 6 })]
    assert.deepEqual([2, 3].map((phaseNo) => sourceOf(added, phaseNo, 'cabc').npcId), [5, 6])
    assert.equal(sourceOf([], 1, builtInKey(11)).npcId, 11)
    assert.equal(sourceOf([], 1, builtInKey(11)).builtIn, true)
    assert.equal(sourceOf([source(900, 'cabc', 1, { name: 'A' })], 1, 'cabc').builtIn, false)
  })
})

describe('zones follow the phases', () => {
  const lair = zoneDoc(LAIR, 2)
  const boss = source(LAIR, 'cb1', 2, { name: 'Lair Boss', order: 10, itemIds: [601, 602] })

  it('a zone the guild made does not exist before its first document, and is a zone of its own after it', () => {
    assert.deepEqual(mergeTables([capture], [lair, boss], 1).map((zone) => zone.name), ['Test Hollow'])
    const zones = mergeTables([capture], [lair, boss], 2)
    assert.deepEqual(zones.map((zone) => zone.name), ['Guild Lair', 'Test Hollow'])
    assert.equal(zones[0].custom, true)
    assert.equal(zones[0].edited, true)
    assert.deepEqual(zones[0].sources.map((entry) => [entry.name, entry.itemIds]), [['Lair Boss', [601, 602]]])
    const table = dropTablesOf([capture], [lair, boss], 3)[0]
    assert.deepEqual([table.name, table.kind, table.players, table.custom], ['Guild Lair', 'raid', 25, true])
  })

  it('its name, kind and size come from the latest zone document', () => {
    const docs = [lair, zoneDoc(LAIR, 4, { name: 'The Lair', kind: 'dungeon', players: 10 })]
    const at3 = mergeTables([], docs, 3)[0]
    const at4 = mergeTables([], docs, 4)[0]
    assert.deepEqual([at3.name, at3.kind, at3.players], ['Guild Lair', 'raid', 25])
    assert.deepEqual([at4.name, at4.kind, at4.players], ['The Lair', 'dungeon', 10])
  })

  it('a zone is in the lists until a zone document takes it out, and again from the one that puts it back', () => {
    const docs = [lair, zoneDoc(LAIR, 3, { removed: true }), zoneDoc(LAIR, 5, { removed: false }), boss]
    const inAt = (phaseNo: number) => mergeTables([], docs, phaseNo).find((zone) => zone.zoneId === LAIR)?.inPhase
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(inAt), [undefined, true, false, false, true, true])
    assert.deepEqual(dropTablesOf([], docs, 4), [])
    assert.deepEqual(dropTablesOf([], docs, 5).map((table) => table.name), ['Guild Lair'])
  })

  it('a zone of the built-in captures can be out of some phases and in the others', () => {
    const docs = [presence(900, 2, true), presence(900, 4, false)]
    const inAt = (phaseNo: number) => zoneOf(docs, phaseNo).inPhase
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(inAt), [true, true, false, false, true, true])
    assert.deepEqual(dropTablesOf([capture, other], docs, 3).map((table) => table.name), ['Another Cave'])
    // The creatures and their items survive being out of a phase.
    assert.deepEqual(items([overlay('11', 1, { itemIds: [104] }), presence(900, 2, true)], 3), [101, 102, 103, 104])
  })

  it('a presence document for a zone nobody has, and creature documents of a zone nobody has, are ignored', () => {
    const orphan = source(LAIR + 1, 'cx', 1, { itemIds: [1] })
    assert.deepEqual(mergeTables([capture], [presence(12345, 1, true), orphan], 3).map((zone) => zone.name), ['Test Hollow'])
  })

  it('edited says whether the guild wrote anything about the zone by then', () => {
    assert.equal(zoneOf([], 3).edited, false)
    assert.equal(zoneOf([overlay('11', 2, { itemIds: [104] })], 1).edited, false)
    assert.equal(zoneOf([overlay('11', 2, { itemIds: [104] })], 2).edited, true)
    assert.equal(zoneOf([presence(900, 2, true)], 3).edited, true)
    assert.equal(dropTablesOf([capture], [overlay('11', 2, { itemIds: [104] })], 2)[0].edited, true)
  })

  it('the zone document written in exactly this phase is reported', () => {
    assert.equal(zoneOf([presence(900, 2, true)], 2).doc?.phaseNo, 2)
    assert.equal(zoneOf([presence(900, 2, true)], 3).doc, undefined)
  })
})

describe('parseItemIds', () => {
  it('reads plain numbers, links and a mixed paste, once each', () => {
    const { ids, ignored } = parseItemIds('872, 1234\nhttps://www.wowhead.com/forever/item=273804/some-name  item=55;  872 [Not a number] 0 99999999999')
    assert.deepEqual(ids, [872, 1234, 273804, 55])
    assert.deepEqual(ignored, ['[Not', 'a', 'number]', '0', '99999999999'])
  })
  it('gives nothing for nothing', () => {
    assert.deepEqual(parseItemIds('  \n '), { ids: [], ignored: [] })
  })
})

describe('keys and numbers', () => {
  it('a new creature key matches what the rules accept, and a new zone number is custom and not taken', () => {
    for (let i = 0; i < 50; i += 1) assert.match(newCreatureKey(), /^[A-Za-z0-9]{1,30}$/)
    const taken = new Set<number>()
    for (let i = 0; i < 50; i += 1) { const id = newZoneId(taken); assert.ok(id >= CUSTOM_ZONE_MIN && id <= 99_999_999); assert.ok(!taken.has(id)); taken.add(id) }
  })
  it('document ids carry the phase', () => {
    assert.equal(zoneDocId(60000001, 3), 'z60000001_3')
    assert.equal(sourceDocId(719, 'npc4887', 12), 's719_npc4887_12')
  })
})

describe('adding items in a phase', () => {
  it('to a creature with no document of this phase creates one with only what this phase adds', () => {
    const zone = zoneOf([], 2)
    const result = addItems(zone, zone.sources[0], [104, 105])
    assert.deepEqual(result.added, [104, 105])
    assert.ok(result.write && 'create' in result.write)
    if (result.write && 'create' in result.write) {
      assert.equal(result.write.id, sourceDocId(900, builtInKey(11), 2))
      assert.deepEqual(result.write.create, { type: 'source', zoneId: 900, key: builtInKey(11), phaseNo: 2, itemIds: [104, 105], hiddenItemIds: [] })
    }
  })

  it('a creature that has a document of an earlier phase still gets a new one for this phase, and keeps what it has as it is', () => {
    const docs = [overlay('11', 1, { itemIds: [104] })]
    const zone = zoneOf(docs, 2)
    const result = addItems(zone, zone.sources[0], [105])
    assert.ok(result.write && 'create' in result.write)
    if (result.write && 'create' in result.write) assert.deepEqual((result.write.create as SourceTableDoc).itemIds, [105])
    assert.deepEqual(zone.sources[0].itemIds, [101, 102, 103, 104])
  })

  it('to a creature with a document of this phase is an edit of its item list, after the ones it added', () => {
    const docs = [overlay('11', 2, { itemIds: [104] })]
    const zone = zoneOf(docs, 2)
    const result = addItems(zone, zone.sources[0], [105])
    assert.ok(result.write && 'existing' in result.write)
    if (result.write && 'existing' in result.write) assert.deepEqual(result.write.changes, { itemIds: [104, 105] })
  })

  it('leaves an item the zone already has where it is, and says where', () => {
    const zone = zoneOf([], 1)
    const result = addItems(zone, zone.sources[1], [101, 999])
    assert.deepEqual(result.alreadyIn, [{ id: 101, where: 'First Warden' }])
    assert.deepEqual(result.added, [999])
  })

  it('brings back an item this phase took off', () => {
    const zone = zoneOf([overlay('11', 2, { hiddenItemIds: [102] })], 2)
    const result = addItems(zone, zone.sources[0], [102])
    assert.deepEqual(result.added, [102])
    assert.ok(result.write && 'existing' in result.write)
    if (result.write && 'existing' in result.write) assert.deepEqual(result.write.changes, { hiddenItemIds: [] })
  })

  it('an item an earlier phase took off is added as new in this one', () => {
    const zone = zoneOf([overlay('11', 1, { hiddenItemIds: [102] })], 2)
    const result = addItems(zone, zone.sources[0], [102])
    assert.deepEqual(result.added, [102])
    assert.ok(result.write && 'create' in result.write)
    if (result.write && 'create' in result.write) assert.deepEqual((result.write.create as SourceTableDoc).itemIds, [102])
  })

  it('refuses a creature over the limit, and writes nothing for nothing new', () => {
    const zone = zoneOf([], 1)
    const lots = Array.from({ length: TABLE_ITEMS_MAX + 1 }, (_, index) => 5000 + index)
    assert.equal(addItems(zone, zone.sources[0], lots).tooMany, true)
    assert.equal(addItems(zone, zone.sources[0], lots).write, null)
    assert.equal(addItems(zone, zone.sources[0], [101]).write, null)
    assert.equal(addItems(zone, zone.sources[0], []).write, null)
  })

  it('counts an item of another creature, and of the zone-wide list, as held, but not one of a removed creature', () => {
    const holders = itemHolders(zoneOf([], 1))
    assert.equal(holders.get(201), 'Second Warden')
    assert.equal(holders.get(901), 'Any creature in the zone')
    const removed = source(900, 'cabc', 1, { name: 'Gone', order: 40, itemIds: [700], removed: true })
    assert.equal(itemHolders(zoneOf([removed], 1)).has(700), false)
  })
})

describe('taking items off in a phase', () => {
  it('an item this phase added is taken back off this phase list; one it had from before is taken off from this phase on', () => {
    const docs = [overlay('11', 1, { itemIds: [104] }), overlay('11', 2, { itemIds: [105] })]
    const zone = zoneOf(docs, 2)
    const target = zone.sources[0]
    const own = takeOffItem(zone, target, 105)
    assert.ok(own && 'existing' in own)
    if (own && 'existing' in own) assert.deepEqual(own.changes, { itemIds: [] })
    const inherited = takeOffItem(zone, target, 104)
    assert.ok(inherited && 'existing' in inherited)
    if (inherited && 'existing' in inherited) assert.deepEqual(inherited.changes, { hiddenItemIds: [104] })
    const fromCapture = takeOffItem(zone, target, 101)
    assert.ok(fromCapture && 'existing' in fromCapture)
    assert.equal(takeOffItem(zone, target, 999), null)
  })

  it('taking an item off a creature with no document of this phase creates one that takes it off', () => {
    const zone = zoneOf([], 2)
    const write = takeOffItem(zone, zone.sources[1], 201)
    assert.ok(write && 'create' in write)
    if (write && 'create' in write) assert.deepEqual(write.create, { type: 'source', zoneId: 900, key: builtInKey(12), phaseNo: 2, itemIds: [], hiddenItemIds: [201] })
  })

  it('an item already taken off cannot be taken off again, and one this phase took off can be brought back', () => {
    const zone = zoneOf([overlay('11', 2, { hiddenItemIds: [102] })], 2)
    assert.equal(takeOffItem(zone, zone.sources[0], 102), null)
    assert.equal(restoreItem(zone, zone.sources[0], 101), null)
    const back = restoreItem(zone, zone.sources[0], 102)
    assert.ok(back && 'existing' in back)
    if (back && 'existing' in back) assert.deepEqual(back.changes, { hiddenItemIds: [] })
  })
})

describe('creatures in a phase', () => {
  it('a new creature is met after the others, with the key it is given, in the phase being edited', () => {
    const write = addCreature(zoneOf([], 2), { name: '  New Add ', kind: 'rare', npcId: 77 }, 'cnew')
    assert.ok('create' in write)
    if ('create' in write) assert.deepEqual(write.create, { type: 'source', zoneId: 900, key: 'cnew', phaseNo: 2, name: 'New Add', kind: 'rare', npcId: 77, order: 40, itemIds: [], hiddenItemIds: [] })
    assert.equal(write.id, sourceDocId(900, 'cnew', 2))
  })

  it('only a creature the guild added can be removed, and it can be brought back; the write says which phase', () => {
    const added = source(900, 'cabc', 1, { name: 'Mine', order: 40, itemIds: [700] })
    const zone = zoneOf([added], 2)
    const mine = zone.sources.find((entry) => entry.key === 'cabc')!
    const removal = setCreatureRemoved(zone, mine, true)
    assert.ok(removal && 'create' in removal)
    if (removal && 'create' in removal) assert.deepEqual(removal.create, { type: 'source', zoneId: 900, key: 'cabc', phaseNo: 2, itemIds: [], hiddenItemIds: [], removed: true })
    assert.equal(setCreatureRemoved(zone, mine, false), null) // not removed
    assert.equal(setCreatureRemoved(zone, zone.sources[0], true), null) // built in
    assert.equal(setCreatureRemoved(zone, zone.zoneWide, true), null)
    const gone = zoneOf([added, source(900, 'cabc', 2, { name: 'Mine', order: 40, removed: true })], 2)
    const back = setCreatureRemoved(gone, gone.sources.find((entry) => entry.key === 'cabc')!, false)
    assert.ok(back && 'existing' in back)
    if (back && 'existing' in back) assert.deepEqual(back.changes, { removed: false })
  })

  it('renaming needs a name and a difference, and only a creature the guild added can be renamed', () => {
    const zone = zoneOf([source(900, 'cabc', 1, { name: 'Mine', kind: 'boss', order: 40 })], 2)
    const mine = zone.sources.find((entry) => entry.key === 'cabc')!
    assert.equal(renameCreature(zone, mine, '  ', 'boss'), null)
    assert.equal(renameCreature(zone, mine, 'Mine', 'boss'), null)
    const write = renameCreature(zone, mine, 'Theirs', 'rare')
    assert.ok(write && 'create' in write)
    if (write && 'create' in write) assert.deepEqual(write.create, { type: 'source', zoneId: 900, key: 'cabc', phaseNo: 2, itemIds: [], hiddenItemIds: [], name: 'Theirs', kind: 'rare' })
    assert.equal(renameCreature(zone, zone.sources[0], 'Warden One', 'rare'), null) // a creature of the built-in lists keeps its name
  })

  it('moving a creature trades its place with its neighbor, and the first and last cannot go further out', () => {
    const zone = zoneOf([], 1)
    assert.deepEqual(moveCreature(zone, zone.sources[0], -1), [])
    assert.deepEqual(moveCreature(zone, zone.sources[2], 1), [])
    const writes = moveCreature(zone, zone.sources[1], -1)
    assert.equal(writes.length, 2)
    const orders = Object.fromEntries(writes.map((write) => ('create' in write ? [write.id, (write.create as SourceTableDoc).order] : ['', 0])))
    assert.deepEqual(writes.map((write) => ('create' in write ? Object.keys(write.create).sort() : [])), [['hiddenItemIds', 'itemIds', 'key', 'order', 'phaseNo', 'type', 'zoneId'], ['hiddenItemIds', 'itemIds', 'key', 'order', 'phaseNo', 'type', 'zoneId']]) // only the place, no copy of the name
    assert.deepEqual(orders, { [sourceDocId(900, builtInKey(12), 1)]: 10, [sourceDocId(900, builtInKey(11), 1)]: 20 })
  })

  it('moving creatures that share a place still swaps them, with the fewest writes that make the order exact', () => {
    const docs = [source(900, 'ca', 1, { name: 'A', kind: 'boss', order: 50 }), source(900, 'cb', 1, { name: 'B', kind: 'boss', order: 50 }), source(900, 'cc', 1, { name: 'C', kind: 'boss', order: 50 })]
    const zone = zoneOf(docs, 1)
    const names = (list: LootTableDoc[]) => zoneOf(list, 1).sources.filter((entry) => ['ca', 'cb', 'cc'].includes(entry.key)).map((entry) => entry.name)
    assert.deepEqual(names(docs), ['A', 'B', 'C'])
    const apply = (writes: ReturnType<typeof moveCreature>) => writes.reduce<LootTableDoc[]>((list, write) => {
      if ('create' in write) return [...list, { ...(write.create as SourceTableDoc), id: write.id, rev: 1 }]
      return list.map((doc) => (doc.id === write.id ? ({ ...doc, ...write.changes } as LootTableDoc) : doc))
    }, docs)
    const b = zone.sources.find((entry) => entry.key === 'cb')!
    assert.deepEqual(names(apply(moveCreature(zone, b, -1))), ['B', 'A', 'C'])
    assert.deepEqual(names(apply(moveCreature(zone, b, 1))), ['A', 'C', 'B'])
  })
})

describe('zones in a phase', () => {
  it('a new zone gets a custom number and a document of the phase it is added in', () => {
    const { zoneId, write } = addZone({ name: ' Guild Lair ', kind: 'raid', players: 25 }, [], 3)
    assert.ok(zoneId >= CUSTOM_ZONE_MIN)
    assert.ok('create' in write)
    if ('create' in write) assert.deepEqual(write.create, { type: 'zone', zoneId, phaseNo: 3, name: 'Guild Lair', kind: 'raid', players: 25 })
    assert.equal(write.id, zoneDocId(zoneId, 3))
  })

  it('renaming or resizing a custom zone writes the document of this phase: an edit when there is one, a new one with only the change when there is not', () => {
    const merged = mergeTables([], [zoneDoc(LAIR, 2)], 2)[0]
    assert.equal(editZone(merged, { name: 'Guild Lair', kind: 'raid', players: 25 }), null)
    const renamed = editZone(merged, { name: 'The Lair', kind: 'dungeon', players: 10 })
    assert.ok(renamed && 'existing' in renamed)
    if (renamed && 'existing' in renamed) assert.deepEqual(renamed.changes, { name: 'The Lair', kind: 'dungeon', players: 10 })
    const later = mergeTables([], [zoneDoc(LAIR, 2)], 3)[0]
    const copy = editZone(later, { name: 'The Lair', kind: 'raid', players: 25 })
    assert.ok(copy && 'create' in copy)
    if (copy && 'create' in copy) assert.deepEqual(copy.create, { type: 'zone', zoneId: LAIR, phaseNo: 3, name: 'The Lair' })
  })

  it('a zone of the built-in captures cannot be renamed or resized', () => {
    assert.equal(editZone(zoneOf([], 1), { name: 'Renamed', kind: 'raid', players: 40 }), null)
  })

  it('every zone can be taken out of a phase and put back, with a document that says only that', () => {
    const builtIn = zoneOf([], 2)
    const out = setZoneInPhase(builtIn, false)
    assert.ok(out && 'create' in out)
    if (out && 'create' in out) assert.deepEqual(out.create, { type: 'zone', zoneId: 900, phaseNo: 2, removed: true })
    assert.equal(setZoneInPhase(builtIn, true), null) // already in
    const custom = mergeTables([], [zoneDoc(LAIR, 1)], 2)[0]
    const customOut = setZoneInPhase(custom, false)
    assert.ok(customOut && 'create' in customOut)
    if (customOut && 'create' in customOut) assert.deepEqual(customOut.create, { type: 'zone', zoneId: LAIR, phaseNo: 2, removed: true })
    const takenOut = zoneOf([presence(900, 2, true)], 2)
    const back = setZoneInPhase(takenOut, true)
    assert.ok(back && 'existing' in back)
    if (back && 'existing' in back) assert.deepEqual(back.changes, { removed: false })
    const laterOut = zoneOf([presence(900, 2, true)], 3)
    const put = setZoneInPhase(laterOut, true)
    assert.ok(put && 'create' in put)
    if (put && 'create' in put) assert.deepEqual(put.create, { type: 'zone', zoneId: 900, phaseNo: 3, removed: false })
  })
})

describe('readTableDoc', () => {
  const rawSource = { type: 'source', zoneId: 900, key: 'cabc', phaseNo: 2, name: 'Warden', kind: 'boss', order: 20, itemIds: [1, 2], hiddenItemIds: [3], rev: 2 }
  const id = sourceDocId(900, 'cabc', 2)

  it('reads a good creature document as it is', () => {
    assert.deepEqual(readTableDoc(id, rawSource), { id, type: 'source', zoneId: 900, key: 'cabc', phaseNo: 2, name: 'Warden', kind: 'boss', order: 20, itemIds: [1, 2], hiddenItemIds: [3], rev: 2 })
  })

  it('reads a custom zone document with only what it says, and a presence document for a built-in zone', () => {
    assert.deepEqual(readTableDoc(zoneDocId(CUSTOM_ZONE_MIN, 1), { type: 'zone', zoneId: CUSTOM_ZONE_MIN, phaseNo: 1, name: 'Lair' }), { id: `z${CUSTOM_ZONE_MIN}_1`, type: 'zone', zoneId: CUSTOM_ZONE_MIN, phaseNo: 1, name: 'Lair', rev: 0 })
    assert.deepEqual(readTableDoc(zoneDocId(900, 3), { type: 'zone', zoneId: 900, phaseNo: 3, removed: true, rev: 1 }), { id: 'z900_3', type: 'zone', zoneId: 900, phaseNo: 3, removed: true, rev: 1 })
  })

  it('a presence document says at most whether the zone is in; a name on it is not read, and an empty one is neutral', () => {
    assert.deepEqual(readTableDoc(zoneDocId(900, 3), { type: 'zone', zoneId: 900, phaseNo: 3 }), { id: 'z900_3', type: 'zone', zoneId: 900, phaseNo: 3, rev: 0 })
    assert.equal((readTableDoc(zoneDocId(900, 3), { type: 'zone', zoneId: 900, phaseNo: 3, removed: false, name: 'Impostor' }) as ZoneTableDoc).name, undefined)
    assert.deepEqual(mergeTables([capture], [readTableDoc(zoneDocId(900, 3), { type: 'zone', zoneId: 900, phaseNo: 3 }) as ZoneTableDoc], 3).map((zone) => zone.inPhase), [true])
  })

  it('a custom zone or creature that no document names does not exist', () => {
    assert.deepEqual(mergeTables([], [readTableDoc(zoneDocId(CUSTOM_ZONE_MIN, 1), { type: 'zone', zoneId: CUSTOM_ZONE_MIN, phaseNo: 1 }) as ZoneTableDoc], 2), [])
    assert.equal(zoneOf([source(900, 'cabc', 1, { itemIds: [1] })], 1).sources.some((entry) => entry.key === 'cabc'), false)
  })

  it('keeps only whole item numbers, once each', () => {
    const doc = readTableDoc(id, { ...rawSource, itemIds: [1, '2', 2.5, -1, 0, 1, null, 7], hiddenItemIds: 'nope' }) as SourceTableDoc
    assert.deepEqual(doc.itemIds, [1, 7])
    assert.deepEqual(doc.hiddenItemIds, [])
  })

  it('skips a document with no usable number, phase, kind of document, or one filed under another id; a blank name is left out', () => {
    assert.equal((readTableDoc(id, { ...rawSource, name: '  ' }) as SourceTableDoc).name, undefined)
    assert.equal(readTableDoc(id, { ...rawSource, zoneId: 'x' }), null)
    assert.equal(readTableDoc(id, { ...rawSource, type: 'thing' }), null)
    assert.equal(readTableDoc(id, { ...rawSource, phaseNo: 'two' }), null)
    assert.equal(readTableDoc(id, { ...rawSource, phaseNo: -1 }), null)
    assert.equal(readTableDoc(id, { ...rawSource, phaseNo: 32 }), null)
    assert.notEqual(readTableDoc(sourceDocId(900, 'cabc', 31), { ...rawSource, phaseNo: 31 }), null) // 30 finished phases make the next one 31
    assert.equal(readTableDoc(id, { ...rawSource, phaseNo: 3 }), null) // the id says phase 2
    assert.equal(readTableDoc('s900_other_2', rawSource), null)
    assert.equal(readTableDoc('s900_cabc', rawSource), null) // an id without a phase
    assert.equal(readTableDoc(sourceDocId(900, 'a_b', 2), { ...rawSource, key: 'a_b' }), null)
  })

  it('reads removed only when it is a boolean, and leaves out a bad kind, order and player count', () => {
    assert.equal((readTableDoc(id, { ...rawSource, removed: true }) as SourceTableDoc).removed, true)
    assert.equal((readTableDoc(id, { ...rawSource, removed: false }) as SourceTableDoc).removed, false)
    assert.equal((readTableDoc(id, { ...rawSource, removed: 'yes' }) as SourceTableDoc).removed, undefined)
    const odd = readTableDoc(id, { ...rawSource, kind: 'dragon', order: -5 }) as SourceTableDoc
    assert.deepEqual([odd.kind, odd.order], [undefined, undefined])
    const zone = readTableDoc(zoneDocId(CUSTOM_ZONE_MIN, 1), { type: 'zone', zoneId: CUSTOM_ZONE_MIN, phaseNo: 1, name: 'Lair', kind: 'raid', players: 400 }) as ZoneTableDoc
    assert.deepEqual([zone.kind, zone.players], ['raid', undefined])
  })
})

describe('firstPhases', () => {
  it('finds the phase each custom zone and each creature was first written in', () => {
    const docs: LootTableDoc[] = [zoneDoc(LAIR, 3), zoneDoc(LAIR, 2), presence(900, 4, true), source(LAIR, 'cb1', 5, { name: 'Late' }), source(LAIR, 'cb1', 2, { name: 'Early' }), overlay('11', 1, { itemIds: [1] })]
    const first = firstPhases(docs)
    assert.equal(first.zones.get(LAIR), 2)
    assert.equal(first.zones.get(900), 4)
    assert.equal(first.sources.get(`${LAIR}_cb1`), 2)
    assert.equal(first.sources.get(`900_${builtInKey(11)}`), 1)
  })
})

describe('"same unless changed" holds for attributes too', () => {
  it('a rename or a move made in an earlier phase reaches a later phase that only changed items', () => {
    // Phase 3 (prepared first) only takes an item off Second Warden; phase 2 then swaps the Wardens and renames the Rare Hound's neighbor.
    const docs = [
      overlay('12', 3, { hiddenItemIds: [201] }),
      source(900, 'cx', 1, { name: 'Added One', order: 25, itemIds: [900] }),
      source(900, 'cx', 2, { name: 'Renamed One', order: 5 }),
      overlay('11', 2, { order: 30 }),
    ]
    const names2 = zoneOf(docs, 2).sources.map((entry) => entry.name)
    const names3 = zoneOf(docs, 3).sources.map((entry) => entry.name)
    assert.deepEqual(names2, ['Renamed One', 'Second Warden', 'First Warden', 'Rare Hound']) // First Warden is moved to 30 and ties with Rare Hound (30): by name
    assert.deepEqual(names3, names2)
    assert.deepEqual(items(docs, 3, builtInKey(12)), [202])
  })

  it('a later phase that sets an attribute itself keeps it, and a phase that follows takes the earlier value again', () => {
    const docs = [overlay('13', 1, { order: 5 }), overlay('13', 3, { order: 35 })]
    assert.equal(sourceOf(docs, 2, builtInKey(13)).order, 5)
    assert.equal(sourceOf(docs, 3, builtInKey(13)).order, 35)
    assert.equal(sourceOf([overlay('13', 1, { order: 5 }), overlay('13', 3, {})], 3, builtInKey(13)).order, 5)
  })

  it('zone attributes follow the same way', () => {
    const docs = [zoneDoc(LAIR, 1), zoneDoc(LAIR, 3, { name: undefined, kind: undefined, players: undefined, removed: true }), zoneDoc(LAIR, 2, { name: 'Fortress', players: 40, kind: undefined })]
    const at = (phaseNo: number) => { const zone = mergeTables([], docs, phaseNo)[0]; return [zone.name, zone.kind, zone.players, zone.inPhase] }
    assert.deepEqual(at(1), ['Guild Lair', 'raid', 25, true])
    assert.deepEqual(at(2), ['Fortress', 'raid', 40, true])
    assert.deepEqual(at(3), ['Fortress', 'raid', 40, false])
  })
})

describe('documents are folded in numeric phase order', () => {
  it('phase 10 comes after phase 2, not before it', () => {
    const docs = [overlay('11', 10, { itemIds: [102] }), overlay('11', 2, { hiddenItemIds: [102] })]
    assert.deepEqual(items(docs, 5), [101, 103])
    assert.deepEqual(items(docs, 10), [101, 103, 102])
  })
})

describe('items that went away, items on two creatures, and the rules the merge repeats', () => {
  it('lists the items a creature had and no longer has, apart from the ones this phase took off', () => {
    const docs = [overlay('11', 1, { itemIds: [104], hiddenItemIds: [101] }), overlay('11', 3, { hiddenItemIds: [102] })]
    const at2 = sourceOf(docs, 2, builtInKey(11))
    assert.deepEqual(at2.goneItemIds, [101])
    const at3 = sourceOf(docs, 3, builtInKey(11))
    assert.deepEqual(at3.goneItemIds, [101])
    assert.deepEqual(at3.hiddenItemIds, [102])
    assert.deepEqual(sourceOf(docs, 4, builtInKey(11)).goneItemIds, [101, 102])
  })

  it('an item two creatures of a zone came to have stays with the first one in Browse drops', () => {
    const docs = [overlay('12', 1, { itemIds: [60] }), overlay('13', 2, { itemIds: [60] })]
    const table = dropTablesOf([capture], docs, 2)[0]
    assert.deepEqual(table.sources.map((entry) => entry.itemIds), [[101, 102, 103], [201, 202, 60], [301]])
  })

  it('a document cannot take a creature of a capture, or the zone-wide list, out of the lists, or make an ordinary creature zone-wide', () => {
    const docs = [overlay('11', 1, { removed: true }), source(900, ZONE_WIDE_KEY, 1, { removed: true }), overlay('12', 1, { kind: 'zonewide' })]
    const zone = zoneOf(docs, 1)
    assert.equal(zone.sources.find((entry) => entry.key === builtInKey(11))?.removed, false)
    assert.equal(zone.zoneWide.removed, false)
    assert.equal(zone.sources.find((entry) => entry.key === builtInKey(12))?.kind, 'boss')
    assert.deepEqual(dropTablesOf([capture], docs, 1)[0].sources.map((entry) => entry.name), ['First Warden', 'Second Warden', 'Rare Hound'])
  })

  it('a zone of a capture with a fromPhase is out of the earlier phases unless a document says otherwise', () => {
    const raid = { ...capture, zoneId: 950, name: 'Late Raid', fromPhase: 2 }
    const inAt = (docs: LootTableDoc[], phaseNo: number) => mergeTables([raid], docs, phaseNo)[0].inPhase
    assert.deepEqual([0, 1, 2, 3].map((phaseNo) => inAt([], phaseNo)), [false, false, true, true])
    assert.deepEqual([0, 1, 2, 3].map((phaseNo) => inAt([presence(950, 1, false)], phaseNo)), [false, true, true, true])
    assert.deepEqual([0, 1, 2, 3].map((phaseNo) => inAt([presence(950, 3, true)], phaseNo)), [false, false, true, false])
  })
})

describe('following the previous phase again', () => {
  it('takes away everything a phase\'s document says about a creature, unless the creature starts there', () => {
    const docs = [overlay('11', 2, { itemIds: [104], hiddenItemIds: [101], order: 5 })]
    const zone = zoneOf(docs, 2)
    const write = resetCreature(zone, zone.sources.find((entry) => entry.key === builtInKey(11))!)
    assert.ok(write && 'existing' in write)
    if (write && 'existing' in write) assert.deepEqual(write.changes, { itemIds: [], hiddenItemIds: [], name: undefined, kind: undefined, order: undefined, npcId: undefined, removed: undefined })
    const starts = zoneOf([source(900, 'cabc', 2, { name: 'Mine', order: 40 })], 2)
    assert.equal(resetCreature(starts, starts.sources.find((entry) => entry.key === 'cabc')!), null)
    assert.equal(resetCreature(zoneOf([], 2), zoneOf([], 2).sources[0]), null) // no document to take away
    const later = zoneOf([source(900, 'cabc', 1, { name: 'Mine', order: 40 }), source(900, 'cabc', 2, { itemIds: [5] })], 2)
    assert.ok(resetCreature(later, later.sources.find((entry) => entry.key === 'cabc')!))
  })

  it('does the same for a zone, and a zone that starts in the phase has nothing to follow', () => {
    const out = zoneOf([presence(900, 2, true)], 2)
    const write = resetZone(out)
    assert.ok(write && 'existing' in write)
    if (write && 'existing' in write) assert.deepEqual(write.changes, { removed: undefined })
    assert.equal(resetZone(mergeTables([], [zoneDoc(LAIR, 2)], 2)[0]), null)
    const renamed = mergeTables([], [zoneDoc(LAIR, 1), zoneDoc(LAIR, 2, { name: 'Fort', kind: undefined, players: undefined })], 2)[0]
    const zoneWrite = resetZone(renamed)
    assert.ok(zoneWrite && 'existing' in zoneWrite)
    if (zoneWrite && 'existing' in zoneWrite) assert.deepEqual(zoneWrite.changes, { removed: undefined, name: undefined, kind: undefined, players: undefined })
  })
})

describe('describePreparedTables', () => {
  it('says nothing when nothing is written for the phase', () => {
    assert.equal(describePreparedTables([overlay('11', 1, { itemIds: [1] })], 2), '')
  })
  it('says what a phase adds, takes out and puts back', () => {
    const docs: LootTableDoc[] = [zoneDoc(LAIR, 2, { name: 'Molten Test' }), presence(900, 2, true), presence(800, 2, false), overlay('11', 2, { itemIds: [1] }), overlay('11', 2, { itemIds: [1] }), overlay('12', 2, { itemIds: [1] })]
    assert.equal(describePreparedTables(docs, 2), 'adds the zone Molten Test, takes 1 zone out of the lists, puts 1 zone back and changes 2 creatures')
    assert.equal(describePreparedTables([overlay('13', 3, { itemIds: [1] })], 3), 'changes 1 creature')
  })
  it('does not count a custom zone that an earlier phase made as added', () => {
    assert.equal(describePreparedTables([zoneDoc(LAIR, 1), zoneDoc(LAIR, 2, { name: 'Renamed' })], 2), 'changes the zones')
  })
})

describe('what a person can paste or type', () => {
  it('ids pasted twice are added once, so the document never holds a repeat the Log could not reproduce', () => {
    const zone = zoneOf([], 2)
    const result = addItems(zone, zone.sources[0], [950, 950, 951])
    assert.deepEqual(result.added, [950, 951])
    assert.ok(result.write && 'create' in result.write)
    if (result.write && 'create' in result.write) assert.deepEqual((result.write.create as SourceTableDoc).itemIds, [950, 951])
  })

  it('a name needs a character that is more than a space or a control character, which the rules treat as blank', () => {
    assert.equal(hasText('Hogger'), true)
    assert.equal(hasText('  A '), true)
    for (const blank of ['', '   ', '\u0000', '\u001f', ' \t\n ', '\u0001\u0002']) assert.equal(hasText(blank), false, JSON.stringify(blank))
    const added = zoneOf([source(900, 'cabc', 1, { name: 'Mine', kind: 'boss', order: 40 })], 2)
    assert.equal(renameCreature(added, added.sources.find((entry) => entry.key === 'cabc')!, '\u001f', 'boss'), null)
    assert.equal(editZone(mergeTables([], [zoneDoc(LAIR, 1)], 1)[0], { name: '\u0001', kind: 'raid', players: 25 }), null)
  })
})
