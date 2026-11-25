import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { JOURNAL_ITEMS_SAVED, applyWrites, buildImportSave, buildPreview, importReason, importStoppedText, journalReason, madeZoneColors, noAnswers, type ImportAnswers, type ImportSetup, type ZoneRow } from '../../src/features/loot/dropImport.ts'
import { captureCandidate, mergeDrops, type DropsSource, type DropsZone } from '../../src/shared/game/dropsString.ts'
import { mergeTables, sourceDocId, zoneDocId, type LootTableDoc, type SourceTableDoc, type TableWrite, type ZoneTableDoc } from '../../src/shared/game/guildTables.ts'
import type { LootTableCapture } from '../../src/shared/game/lootTables.ts'
import { zoneColor } from '../../src/shared/game/zoneColors.ts'

// The worked examples of docs/design/drop-list-import.md section 8. Every name and id is invented; "the phase" is the one picked in the editor (0 here).

const BARROW = 50_000_123 // "Test Barrow", a raid of 10 made in Settings (a random id)
const zoneDoc = (zoneId: number, phaseNo: number, extra: Partial<ZoneTableDoc> = {}): ZoneTableDoc => ({ id: zoneDocId(zoneId, phaseNo), type: 'zone', zoneId, phaseNo, rev: 1, ...extra })
const sourceDoc = (zoneId: number, key: string, phaseNo: number, extra: Partial<SourceTableDoc> = {}): SourceTableDoc =>
  ({ id: sourceDocId(zoneId, key, phaseNo), type: 'source', zoneId, key, phaseNo, itemIds: [], hiddenItemIds: [], rev: 1, ...extra })
const barrowMade = (phaseNo = 0, extra: Partial<ZoneTableDoc> = {}) => zoneDoc(BARROW, phaseNo, { name: 'Test Barrow', kind: 'raid', players: 10, ...extra })

const abbey: LootTableCapture = {
  format: 1, zoneId: 4321, name: 'Test Abbey', kind: 'dungeon', players: 5, source: 'https://example.invalid/abbey', capturedAt: '2026-10-16',
  sources: [{ npcId: 990100, name: 'Abbot of Fixtures', kind: 'boss', itemIds: [900100] }, { npcId: 990101, name: 'Prior Lorem', kind: 'boss', itemIds: [900101] }], zoneWideItemIds: [],
}

const setup = (docs: LootTableDoc[], extra: Partial<ImportSetup> = {}): ImportSetup => ({ captures: [abbey], docs, catalog: [], currentPhase: 0, phaseNo: 0, journalSaving: false, canMakeZones: true, ...extra })
const seen = (itemId: number, n = 1, last = '2026-12-10', extra = {}) => ({ itemId, n, last, via: 'window' as const, ...extra })
const boss = (npcId: number, name: string, itemIds: number[], extra: Partial<DropsSource> = {}): DropsSource => ({ npcId, name, kind: 'boss', itemIds, seen: itemIds.map((id) => seen(id)), ...extra })
const hollow = (sources: DropsSource[], extra: Partial<DropsZone> = {}): DropsZone => ({ name: 'Hollow Test Barrow', kind: 'raid', players: 40, instanceId: 9901, difficultyId: 9, sources, ...extra })
const candidates = (...zones: DropsZone[]) => mergeDrops([{ schema: 1, id: 'd-test-0001', at: 1797474600, by: 'IntrepidManager/test', zones }])
const answers = (patch: Partial<ImportAnswers> = {}): ImportAnswers => ({ ...noAnswers(), ...patch })
const pickBarrow = answers({ zones: { u9901: { pick: BARROW } } })
const zoneOf = (rows: ZoneRow[], id: string) => rows.find((row) => row.id === id) as ZoneRow
const created = (writes: TableWrite[]) => writes.filter((write) => 'create' in write).map((write) => write.id)
const edited = (writes: TableWrite[]) => writes.filter((write) => 'existing' in write).map((write) => write.id)

// The save as the panel runs it: the first call, then the second from the documents after it.
function save(docs: LootTableDoc[], rows: ReturnType<typeof buildPreview>, extra: Partial<ImportSetup> = {}) {
  const plan = buildImportSave(rows, setup(docs, extra))
  const after = applyWrites(docs, plan.first)
  const second = plan.second(after)
  return { first: plan.first, second, after: applyWrites(applyWrites(after, second.ticks), second.journal.flatMap((call) => call.writes)) }
}

describe('the drop list import, worked examples', () => {
  const night1 = candidates(hollow([boss(990001, 'Grimtooth the Test Boss', [900001, 900002]), boss(990002, 'Lady Test Ipsum', [900003])]))

  it('1. asks which zone, then adds two creatures and ticks the zone in', () => {
    const docs = [barrowMade()]
    const unanswered = buildPreview(night1, setup(docs), noAnswers())
    assert.equal(unanswered.zones[0]?.status, 'unmatched')
    assert.equal(unanswered.zones[0]?.unmatchedWhy, 'none')
    assert.equal(unanswered.counts.unanswered, 1)
    const preview = buildPreview(night1, setup(docs), pickBarrow)
    const zone = zoneOf(preview.zones, 'u9901')
    assert.deepEqual(zone.creatures.map((row) => [row.status, row.key, row.items.map((item) => [item.status, item.ticked])]), [
      ['new', 'n990001', [['new', true], ['new', true]]],
      ['new', 'n990002', [['new', true]]],
    ])
    assert.deepEqual(preview.counts, { zones: 1, newZones: 0, creatures: 2, newCreatures: 2, items: 3, journalItems: 0, unanswered: 0 })
    const { first, second } = save(docs, preview)
    assert.deepEqual(created(first), [sourceDocId(BARROW, 'n990001', 0), sourceDocId(BARROW, 'n990002', 0)])
    assert.deepEqual(second.ticks.map((write) => [write.id, 'existing' in write ? write.changes : write.create]), [[zoneDocId(BARROW, 0), { removed: false }]])
  })

  it('2. the same paste again: everything is already listed, nothing to save', () => {
    const docs = save([barrowMade()], buildPreview(night1, setup([barrowMade()]), pickBarrow)).after
    const again = buildPreview(night1, setup(docs), pickBarrow)
    const zone = zoneOf(again.zones, 'u9901')
    assert.deepEqual(zone.creatures.map((row) => [row.status, row.how, row.items.map((item) => item.status)]), [['matched', 'npc', ['already', 'already']], ['matched', 'npc', ['already']]])
    assert.deepEqual(save(docs, again).first, [])
    assert.deepEqual(save(docs, again).second.ticks, [])
  })

  it("3. a second night adds the new item to the boss's document", () => {
    const docs = save([barrowMade()], buildPreview(night1, setup([barrowMade()]), pickBarrow)).after
    const night2 = candidates(hollow([boss(990001, 'Grimtooth the Test Boss', [900001, 900004])]))
    const { first } = save(docs, buildPreview(night2, setup(docs), pickBarrow))
    assert.deepEqual(edited(first), [sourceDocId(BARROW, 'n990001', 0)])
    assert.deepEqual((first[0] as { changes: unknown }).changes, { itemIds: [900001, 900002, 900004] })
  })

  it('4. a Guild Leader makes the zone: its id is fixed from the instance, and a retry only ticks it in', () => {
    const make = answers({ zones: { u9901: { make: true } } })
    const preview = buildPreview(night1, setup([]), make)
    const zone = zoneOf(preview.zones, 'u9901')
    assert.equal(zone.status, 'new')
    assert.equal(zone.zoneId, 50_009_901)
    const plan = buildImportSave(preview, setup([]))
    assert.deepEqual(created(plan.first), [zoneDocId(50_009_901, 0), sourceDocId(50_009_901, 'n990001', 0), sourceDocId(50_009_901, 'n990002', 0)])
    assert.deepEqual((plan.first[0] as { create: unknown }).create, { type: 'zone', zoneId: 50_009_901, phaseNo: 0, name: 'Hollow Test Barrow', kind: 'raid', players: 40 })
    const afterFirst = applyWrites([], plan.first)
    const tick = plan.second(afterFirst).ticks
    assert.deepEqual(tick.map((write) => [write.id, 'existing' in write && write.existing.rev, 'existing' in write && write.changes]), [[zoneDocId(50_009_901, 0), 1, { removed: false }]])
    // The second call never landed: pasting again finds the zone by its fixed id and the creatures by npc id, so only the tick is left.
    const retry = buildPreview(night1, setup(afterFirst), noAnswers())
    assert.equal(retry.zones[0]?.how, 'instance')
    const again = save(afterFirst, retry)
    assert.deepEqual(again.first, [])
    assert.deepEqual(again.second.ticks.map((write) => write.id), [zoneDocId(50_009_901, 0)])
  })

  it('4c. a zone the import makes gets a color no listed zone has, as Settings gives one; a color already chosen stays', () => {
    const make = answers({ zones: { u9901: { make: true } } })
    const docs = [barrowMade()]
    const plan = buildImportSave(buildPreview(night1, setup(docs), make), setup(docs))
    assert.deepEqual(plan.made, [50_009_901])
    const chosen = { [String(BARROW)]: '#d05065', '50009903': '#278794' }
    const colors = madeZoneColors([50_009_901, 50_009_902, 50_009_903], setup(docs), chosen)
    assert.deepEqual(Object.keys(colors), ['50009901', '50009902'])
    const inUse = ['#d05065', zoneColor(4321)]
    assert.ok(Object.values(colors).every((color) => !inUse.includes(color)))
    assert.notEqual(colors['50009901'], colors['50009902'])
    assert.deepEqual(madeZoneColors([], setup(docs), chosen), {})
  })

  it('4b. only a Guild Leader can make a zone', () => {
    const preview = buildPreview(night1, setup([], { canMakeZones: false }), answers({ zones: { u9901: { make: true } } }))
    assert.equal(preview.zones[0]?.status, 'unmatched')
  })

  it('5. an item a leader took off in an earlier phase is offered unticked', () => {
    const follows: LootTableDoc = { id: 'p1', type: 'phase', phaseNo: 1, follows: 0, rev: 1 }
    const docs = [follows, barrowMade(), sourceDoc(BARROW, 'n990001', 0, { name: 'Grimtooth the Test Boss', kind: 'boss', npcId: 990001, itemIds: [900002, 900005] }), sourceDoc(BARROW, 'n990001', 1, { hiddenItemIds: [900002] }), zoneDoc(BARROW, 1, { removed: false })]
    const preview = buildPreview(candidates(hollow([boss(990001, 'Grimtooth the Test Boss', [900002, 900005])])), setup(docs, { phaseNo: 1 }), pickBarrow)
    const items = zoneOf(preview.zones, 'u9901').creatures[0]?.items
    assert.deepEqual(items?.map((item) => [item.itemId, item.status, item.tickable, item.ticked]), [[900002, 'takenOff', true, false], [900005, 'already', false, false]])
  })

  it('6. an item on another creature stays there', () => {
    const docs = [barrowMade(), sourceDoc(BARROW, 'n990001', 0, { name: 'Grimtooth the Test Boss', kind: 'boss', npcId: 990001, itemIds: [900003] })]
    const preview = buildPreview(candidates(hollow([boss(990002, 'Lady Test Ipsum', [900003])])), setup(docs), pickBarrow)
    const item = zoneOf(preview.zones, 'u9901').creatures[0]?.items[0]
    assert.deepEqual([item?.status, item?.where, item?.tickable], ['elsewhere', 'Grimtooth the Test Boss', false])
  })

  it('7 and 21. a creature a leader took out: unticked, and ticking it brings it back with its items in one write; its items stay its own', () => {
    const docs = [barrowMade(), sourceDoc(BARROW, 'n990003', 0, { name: 'Warden of the Test Barrow', kind: 'boss', npcId: 990003, itemIds: [900008], removed: true })]
    const pasted = candidates(hollow([boss(990003, 'Warden of the Test Barrow', [900008, 900009]), boss(990001, 'Grimtooth the Test Boss', [900008])]))
    const preview = buildPreview(pasted, setup(docs), pickBarrow)
    const [warden, grimtooth] = zoneOf(preview.zones, 'u9901').creatures
    assert.deepEqual([warden?.status, warden?.optIn, warden?.saved], ['takenOut', 'takenOut', false])
    assert.deepEqual(grimtooth?.items.map((item) => [item.status, item.where]), [['elsewhere', 'Warden of the Test Barrow (taken out)']])
    const ticked = buildPreview(pasted, setup(docs), { ...pickBarrow, ticks: { 'u9901|cn990003': true } })
    const write = buildImportSave(ticked, setup(docs)).first.find((candidate) => candidate.id === sourceDocId(BARROW, 'n990003', 0))
    assert.deepEqual(write && 'existing' in write && write.changes, { itemIds: [900008, 900009], removed: false })
  })

  it('7b. a creature in the lists wins over one a leader took out with the same npc id or name', () => {
    const docs = [
      barrowMade(),
      sourceDoc(BARROW, 'cold1', 0, { name: 'Grimtooth the Test Boss', kind: 'boss', npcId: 990001, order: 5, itemIds: [900001], removed: true }),
      sourceDoc(BARROW, 'n990001', 0, { name: 'Grimtooth the Test Boss', kind: 'boss', npcId: 990001, order: 10, itemIds: [900002] }),
      sourceDoc(BARROW, 'cold2', 0, { name: 'Test Ghoul', kind: 'trash', order: 15, itemIds: [900050], removed: true }),
      sourceDoc(BARROW, 'cnew2', 0, { name: 'Test Ghoul', kind: 'trash', order: 20, itemIds: [900051] }),
    ]
    const pasted = candidates(hollow([boss(990001, 'Grimtooth the Test Boss', [900003]), { name: 'Test Ghoul', kind: 'trash', itemIds: [900052], seen: [seen(900052)] }]))
    const rows = buildPreview(pasted, setup(docs), pickBarrow).zones[0]?.creatures ?? []
    assert.deepEqual(rows.map((row) => [row.key, row.status, row.how]), [['n990001', 'matched', 'npc'], ['cnew2', 'matched', 'name']])
  })

  it('8. a guessed boss is unticked until a leader ticks it', () => {
    const preview = buildPreview(candidates(hollow([boss(990004, 'Maybe Test Boss', [900010], { guessed: true })])), setup([barrowMade()]), pickBarrow)
    const row = zoneOf(preview.zones, 'u9901').creatures[0]
    assert.deepEqual([row?.optIn, row?.saved, row?.items[0]?.ticked], ['guessed', false, false])
  })

  it('9. trash: an item two trash creatures dropped is offered for the zone-wide list, unticked', () => {
    const trash = (npcId: number, name: string, itemIds: number[], n = 1): DropsSource => ({ npcId, name, kind: 'trash', itemIds, seen: itemIds.map((id) => seen(id, n, '2026-12-10', { boe: true })) })
    const preview = buildPreview(candidates(hollow([trash(990051, 'Test Ghoul', [900050, 900051], 3), trash(990052, 'Test Wight', [900050])])), setup([barrowMade()]), pickBarrow)
    const rows = zoneOf(preview.zones, 'u9901').creatures
    assert.deepEqual(rows.map((row) => [row.name, row.items.map((item) => [item.itemId, item.status, item.ticked])]), [
      ['Test Ghoul', [[900050, 'zoneWide', false], [900051, 'new', false]]],
      ['Test Wight', [[900050, 'zoneWide', false]]],
      ['Any creature in the zone', [[900050, 'new', false]]],
    ])
    assert.deepEqual(rows[2]?.items[0]?.evidence.seen, { n: 3, last: '2026-12-10', via: 'window', boe: true }) // both creatures' counts, the larger kept
  })

  it('10. more items than the room left: the rest are for the next phase', () => {
    const docs = [barrowMade(), sourceDoc(BARROW, 'n990001', 0, { name: 'Grimtooth the Test Boss', kind: 'boss', npcId: 990001, itemIds: Array.from({ length: 70 }, (_, i) => 910000 + i) })]
    const pasted = Array.from({ length: 15 }, (_, i) => 920000 + i)
    const preview = buildPreview(candidates(hollow([boss(990001, 'Grimtooth the Test Boss', pasted)])), setup(docs), pickBarrow)
    const statuses = zoneOf(preview.zones, 'u9901').creatures[0]?.items.map((item) => item.status)
    assert.deepEqual(statuses, [...Array(10).fill('new'), ...Array(5).fill('noRoom')])
  })

  it('10b. an item that is not saved never takes the room of one that is', () => {
    const journal = Array.from({ length: 79 }, (_, i) => 910000 + i)
    const pasted = mergeDrops([
      { schema: 1, id: 'd-test-0003', at: 1797474600, by: 'IntrepidManager/test', journal: 'ForeverDungeonJournal/2.0.3', zones: [hollow([boss(990001, 'Grimtooth the Test Boss', [900001, ...journal], { seen: [seen(900001)], journal })])] },
      { schema: 1, id: 'd-test-0004', at: 1797474600, by: 'IntrepidManager/test', zones: [hollow([boss(990001, 'Grimtooth the Test Boss', [900002, 900003])])] },
    ])
    const preview = buildPreview(pasted, setup([barrowMade()], { journalSaving: true }), pickBarrow)
    const seenItems = preview.zones[0]?.creatures[0]?.items.filter((item) => !item.journalOnly)
    assert.deepEqual(seenItems?.map((item) => [item.itemId, item.status, item.ticked]), [[900001, 'new', true], [900002, 'new', true], [900003, 'new', true]])
    assert.equal(preview.counts.items, 3)
  })

  it('10c. only a row that is saved claims an item: an unticked journal item or an unsaved boss never blocks the boss that dropped it', () => {
    const keep = (sources: DropsSource[]) => mergeDrops([{ schema: 1, id: 'd-test-0005', at: 1797474600, by: 'IntrepidManager/test', journal: 'ForeverDungeonJournal/2.0.3', zones: [{ name: 'Hollow Test Keep', kind: 'dungeon', players: 5, instanceId: 9100, sources }] }])
    const shared = keep([
      boss(990001, 'Aaa Test Boss', [900101, 900777], { seen: [seen(900101)], journal: [900101, 900777] }),
      boss(990002, 'Bbb Test Boss', [900777, 900201], { seen: [seen(900777)], journal: [900201, 900777] }),
    ])
    const make = answers({ zones: { u9100: { make: true, zoneId: 50_009_100 } } })
    const allowed = { journalSaving: true }
    const preview = buildPreview(shared, setup([], allowed), make)
    const [aaa, bbb] = preview.zones[0]?.creatures ?? []
    assert.deepEqual(aaa?.items.map((item) => [item.itemId, item.status, item.ticked]), [[900101, 'new', true], [900777, 'new', false]])
    assert.deepEqual(bbb?.items.map((item) => [item.itemId, item.status, item.ticked]), [[900777, 'new', true], [900201, 'new', false]])
    assert.deepEqual(buildImportSave(preview, setup([], allowed)).first.map((write) => [write.id, 'create' in write && 'itemIds' in write.create && write.create.itemIds]), [
      [zoneDocId(50_009_100, 0), false], [sourceDocId(50_009_100, 'n990001', 0), [900101]], [sourceDocId(50_009_100, 'n990002', 0), [900777]],
    ])
    // Ticked on both, the first creature keeps it, as before.
    const both = buildPreview(shared, setup([], allowed), { ...make, ticks: { [`${aaa?.id}|900777`]: true } })
    assert.deepEqual(both.zones[0]?.creatures[1]?.items[0]?.status, 'claimed')
    // A guessed boss that isn't ticked doesn't block the item either.
    const guessed = keep([boss(990001, 'Aaa Test Boss', [900777], { guessed: true }), boss(990002, 'Bbb Test Boss', [900777])])
    const rows = buildPreview(guessed, setup([], allowed), make).zones[0]?.creatures
    assert.deepEqual(rows?.map((row) => [row.saved, row.items.map((item) => [item.status, item.ticked])]), [[false, [['new', false]]], [true, [['new', true]]]])
  })

  it('11. two wings of one built-in dungeon are one zone', () => {
    const wing = (name: string, npcId: number, itemId: number): DropsZone => ({ name, kind: 'dungeon', players: 5, sources: [boss(npcId, `Boss of ${name}`, [itemId])] })
    const preview = buildPreview(candidates(wing('Test Abbey: Library', 990110, 900110), wing('Test Abbey: Chapel', 990111, 900111)), setup([]), noAnswers())
    assert.equal(preview.zones.length, 1)
    assert.deepEqual([preview.zones[0]?.id, preview.zones[0]?.how, preview.zones[0]?.creatures.length], ['utest abbey: library', 'name', 2])
  })

  it('12. a zone a leader took out of the phase: nothing under it is ticked until it is', () => {
    const docs = [zoneDoc(4321, 0, { removed: true })]
    const pasted = candidates({ name: 'The Test Abbey', kind: 'dungeon', players: 5, sources: [boss(990100, 'Abbot of Fixtures', [900102])] })
    const preview = buildPreview(pasted, setup(docs), noAnswers())
    assert.deepEqual([preview.zones[0]?.takenOut, preview.zones[0]?.zoneTicked, preview.zones[0]?.creatures[0]?.items[0]?.ticked], [true, false, false])
    assert.deepEqual(buildImportSave(preview, setup(docs)).first, [])
    const ticked = buildPreview(pasted, setup(docs), answers({ ticks: { 'utest abbey': true } }))
    assert.equal(ticked.zones[0]?.creatures[0]?.items[0]?.ticked, true)
  })

  it('12b. ticking a zone a leader took out puts it back, also when nothing under it is saved', () => {
    const docs = [zoneDoc(4321, 0, { removed: true })]
    const pasted = candidates({ name: 'The Test Abbey', kind: 'dungeon', players: 5, sources: [boss(990101, 'Prior Lorem', [900100])] })
    const unticked = buildPreview(pasted, setup(docs), noAnswers())
    assert.deepEqual([unticked.zones[0]?.tickIn, unticked.counts.zones], [false, 0])
    const ticked = buildPreview(pasted, setup(docs), answers({ ticks: { [unticked.zones[0]?.id as string]: true } }))
    assert.deepEqual([ticked.zones[0]?.creatures[0]?.items[0]?.status, ticked.zones[0]?.tickIn, ticked.counts.zones], ['elsewhere', true, 1])
    const { first, second } = save(docs, ticked)
    assert.deepEqual(first, [])
    assert.deepEqual(second.ticks.map((write) => [write.id, 'existing' in write && write.changes]), [[zoneDocId(4321, 0), { removed: false }]])
  })

  it("13. a capture file's Wowhead zone id is never an app zone id: the zone is matched by name", () => {
    const capture = captureCandidate({ format: 1, zoneId: 5555, name: 'Test Barrow', kind: 'raid', players: 10, source: 'https://example.invalid/barrow', capturedAt: '2026-12-10', sources: [{ npcId: 990001, name: 'Grimtooth the Test Boss', kind: 'boss', itemIds: [900001] }], zoneWideItemIds: [900060] })
    const preview = buildPreview([capture], setup([barrowMade()]), noAnswers())
    const zone = preview.zones[0] as ZoneRow
    assert.deepEqual([zone.status, zone.how, zone.zoneId], ['matched', 'name', BARROW])
    assert.deepEqual(zone.creatures.map((row) => [row.name, row.items.map((item) => item.ticked)]), [['Grimtooth the Test Boss', [true]], ['Any creature in the zone', [true]]])
    assert.equal(importReason('capture', []), 'Imported from a capture file')
  })

  it("14. an item Wowhead doesn't know yet is still new and ticked, with the game's name", () => {
    const preview = buildPreview(candidates(hollow([{ npcId: 990001, name: 'Grimtooth the Test Boss', kind: 'boss', itemIds: [900099], seen: [seen(900099, 2, '2026-12-17', { name: 'Unknown Test Relic', quality: 4 })] }])), setup([barrowMade()]), pickBarrow)
    const item = zoneOf(preview.zones, 'u9901').creatures[0]?.items[0]
    assert.deepEqual([item?.status, item?.ticked, item?.evidence.seen?.name], ['new', true, 'Unknown Test Relic'])
  })

  it('15. a near name asks "same as" or "new"; "same as" stores the npc id on the app\'s creature', () => {
    const docs = [barrowMade(), sourceDoc(BARROW, 'cgrim1', 0, { name: 'Grimtooth', kind: 'boss', itemIds: [900001] })]
    const pasted = candidates(hollow([boss(990001, 'Grimtooth the Test Boss', [900001, 900011])]))
    const asked = zoneOf(buildPreview(pasted, setup(docs), pickBarrow).zones, 'u9901').creatures[0]
    assert.deepEqual([asked?.status, asked?.near, asked?.saved], ['unmatched', [{ key: 'cgrim1', name: 'Grimtooth' }], false])
    const same = buildPreview(pasted, setup(docs), { ...pickBarrow, creatures: { 'u9901|cn990001': { same: 'cgrim1' } } })
    const row = zoneOf(same.zones, 'u9901').creatures[0]
    assert.deepEqual([row?.status, row?.how, row?.storeNpcId, row?.differs], ['matched', 'answer', 990001, { name: 'Grimtooth the Test Boss' }])
    const write = buildImportSave(same, setup(docs)).first[0]
    assert.deepEqual(write && 'existing' in write && write.changes, { itemIds: [900001, 900011], npcId: 990001 })
    const renamed = buildPreview(pasted, setup(docs), { ...pickBarrow, creatures: { 'u9901|cn990001': { same: 'cgrim1' } }, renames: { 'u9901|cn990001': true } })
    const renameWrite = buildImportSave(renamed, setup(docs)).first[0]
    assert.deepEqual(renameWrite && 'existing' in renameWrite && renameWrite.changes, { itemIds: [900001, 900011], npcId: 990001, name: 'Grimtooth the Test Boss' })
  })

  it("16. DungeonJournal's items are unticked and saved one creature at a time in a second write with their own reason (D6); switched off, they are information", () => {
    assert.equal(JOURNAL_ITEMS_SAVED, true)
    const journalDungeon: DropsZone = { name: 'Hollow Test Keep', kind: 'dungeon', players: 5, journalPartial: true, sources: [{ npcId: 990011, name: 'Warden of Fixtures', kind: 'boss', itemIds: [900101, 900102], journal: [900101, 900102] }] }
    const pasted = mergeDrops([{ schema: 1, id: 'd-test-0002', at: 1797474600, by: 'IntrepidManager/test', journal: 'ForeverDungeonJournal/2.0.3', zones: [journalDungeon] }])
    const make = answers({ zones: { 'uhollow test keep': { make: true, zoneId: 61_234_567 } } })
    const info = buildPreview(pasted, setup([]), make)
    const row = info.zones[0]?.creatures[0]
    assert.deepEqual(row?.items.map((item) => [item.status, item.tickable]), [['journal', false], ['journal', false]])
    assert.deepEqual([row?.optIn, row?.saved], ['noItems', false])
    assert.equal(info.zones[0]?.journal, 'ForeverDungeonJournal/2.0.3')

    const allowed = { journalSaving: true }
    const offered = buildPreview(pasted, setup([], allowed), make)
    assert.deepEqual(offered.zones[0]?.creatures[0]?.items.map((item) => [item.status, item.tickable, item.ticked]), [['new', true, false], ['new', true, false]])
    const zoneId = offered.zones[0]?.zoneId as number
    assert.equal(zoneId, 61_234_567)
    const rowId = `uhollow test keep|cn990011`
    const ticked = buildPreview(pasted, setup([], allowed), { ...make, ticks: { [`${rowId}|900101`]: true, [`${rowId}|900102`]: true } })
    assert.deepEqual(ticked.counts, { zones: 1, newZones: 1, creatures: 1, newCreatures: 1, items: 0, journalItems: 2, unanswered: 0 })
    const { first, second } = save([], ticked, allowed)
    assert.deepEqual(created(first), [zoneDocId(zoneId, 0), sourceDocId(zoneId, 'n990011', 0)])
    assert.deepEqual((first[1] as { create: { itemIds: number[] } }).create.itemIds, [])
    assert.deepEqual(second.journal.flatMap((call) => call.writes).map((write) => [write.id, 'existing' in write && write.changes]), [[sourceDocId(zoneId, 'n990011', 0), { itemIds: [900101, 900102] }]])
    assert.equal(journalReason('ForeverDungeonJournal/2.0.3'), 'From DungeonJournal 2.0.3, not seen in the game')
  })

  it("16c. DungeonJournal's items keep the version of the string that listed them: one journal write per version", () => {
    const listed = (id: string, version: string, name: string, instanceId: number, npcId: number, itemId: number) =>
      ({ schema: 1 as const, id, at: 1797474600, by: 'IntrepidManager/test', journal: version, zones: [{ name, kind: 'dungeon' as const, players: 5, instanceId, sources: [{ npcId, name: `Boss of ${name}`, kind: 'boss' as const, itemIds: [itemId], journal: [itemId] }] }] })
    const pasted = mergeDrops([listed('d-test-0009', 'ForeverDungeonJournal/2.0.3', 'Hollow Test Keep', 9100, 990101, 900101), listed('d-test-0010', 'ForeverDungeonJournal/2.1.0', 'Test Cloister', 9200, 990201, 900201)])
    const given = answers({ zones: { u9100: { make: true }, u9200: { make: true } }, ticks: { 'u9100|cn990101|900101': true, 'u9200|cn990201|900201': true } })
    const allowed = { journalSaving: true }
    const { second } = save([], buildPreview(pasted, setup([], allowed), given), allowed)
    assert.deepEqual(second.journal.map((call) => [call.version, call.writes.map((write) => write.id)]), [
      ['ForeverDungeonJournal/2.0.3', [sourceDocId(50_009_100, 'n990101', 0)]],
      ['ForeverDungeonJournal/2.1.0', [sourceDocId(50_009_200, 'n990201', 0)]],
    ])
    assert.deepEqual(second.journal.map((call) => journalReason(call.version)), ['From DungeonJournal 2.0.3, not seen in the game', 'From DungeonJournal 2.1.0, not seen in the game'])
  })

  it("16b. a creature with a new item seen in the game and one from DungeonJournal gets one write in each call", () => {
    const docs = [barrowMade(), sourceDoc(BARROW, 'n990001', 0, { name: 'Grimtooth the Test Boss', kind: 'boss', npcId: 990001, order: 10, itemIds: [900001] })]
    const pasted = candidates(hollow([boss(990001, 'Grimtooth the Test Boss', [900002, 900101], { seen: [seen(900002)], journal: [900002, 900101] })]))
    const allowed = { journalSaving: true }
    const offered = buildPreview(pasted, setup(docs, allowed), pickBarrow)
    const row = offered.zones[0]?.creatures[0]
    assert.deepEqual(row?.items.map((item) => [item.itemId, item.status, item.journalOnly, item.ticked]), [[900002, 'new', false, true], [900101, 'new', true, false]])
    const ticked = buildPreview(pasted, setup(docs, allowed), { ...pickBarrow, ticks: { [`${row?.id}|900101`]: true } })
    assert.deepEqual([ticked.counts.items, ticked.counts.journalItems], [1, 1])
    const { first, second, after } = save(docs, ticked, allowed)
    const id = sourceDocId(BARROW, 'n990001', 0)
    assert.deepEqual(first.map((write) => [write.id, 'existing' in write && write.changes]), [[id, { itemIds: [900001, 900002] }]])
    assert.deepEqual(second.journal.flatMap((call) => call.writes).map((write) => [write.id, 'existing' in write && write.changes]), [[id, { itemIds: [900001, 900002, 900101] }]])
    assert.deepEqual(edited(second.ticks), [zoneDocId(BARROW, 0)])
    assert.deepEqual((after.find((doc) => doc.id === id) as SourceTableDoc).itemIds, [900001, 900002, 900101])
  })

  it("19. a creature known by its encounter learns its npc id in the same write", () => {
    const docs = [barrowMade(), sourceDoc(BARROW, 'e9102', 0, { name: 'Lady Test Ipsum', kind: 'boss', itemIds: [900003] })]
    const preview = buildPreview(candidates(hollow([boss(990002, 'Lady Test Ipsum', [900003], { encounterId: 9102 })])), setup(docs), pickBarrow)
    const row = zoneOf(preview.zones, 'u9901').creatures[0]
    assert.deepEqual([row?.how, row?.storeNpcId], ['encounter', 990002])
    const write = buildImportSave(preview, setup(docs)).first[0]
    assert.deepEqual(write && 'existing' in write && write.changes, { npcId: 990002 })
  })

  it('19b. two corpses of one encounter never land on the creature an earlier import made from its rolls', () => {
    const docs = [barrowMade(), sourceDoc(BARROW, 'e9110', 0, { name: 'The Test Twins', kind: 'boss', order: 10, itemIds: [900011, 900012] })]
    const twins = candidates(hollow([
      boss(990011, 'Test Twin One', [900011, 900013], { encounterId: 9110 }),
      boss(990012, 'Test Twin Two', [900012, 900014], { encounterId: 9110 }),
    ]))
    const preview = buildPreview(twins, setup(docs), pickBarrow)
    const rows = preview.zones[0]?.creatures ?? []
    assert.deepEqual(rows.map((row) => [row.name, row.status, row.key, row.storeNpcId, row.items.map((item) => [item.itemId, item.status, item.ticked])]), [
      ['Test Twin One', 'new', 'n990011', undefined, [[900011, 'elsewhere', false], [900013, 'new', true]]],
      ['Test Twin Two', 'new', 'n990012', undefined, [[900012, 'elsewhere', false], [900014, 'new', true]]],
    ])
    assert.deepEqual(created(buildImportSave(preview, setup(docs)).first), [sourceDocId(BARROW, 'n990011', 0), sourceDocId(BARROW, 'n990012', 0)])
  })

  it('19c. a corpse never lands on an encounter creature that learned another npc id', () => {
    const docs = [barrowMade(), sourceDoc(BARROW, 'e9102', 0, { name: 'Councillor Alpha', kind: 'boss', npcId: 990021, order: 10, itemIds: [900021] })]
    const preview = buildPreview(candidates(hollow([boss(990022, 'Councillor Beta', [900022], { encounterId: 9102 })])), setup(docs), pickBarrow)
    const row = preview.zones[0]?.creatures[0]
    assert.deepEqual([row?.name, row?.status, row?.key, row?.differs, row?.items.map((item) => [item.status, item.ticked])], ['Councillor Beta', 'new', 'n990022', undefined, [['new', true]]])
    assert.deepEqual(created(buildImportSave(preview, setup(docs)).first), [sourceDocId(BARROW, 'n990022', 0)])
  })

  it("19d. a raider's rolls still join the encounter creature after it learned its npc id, whatever its name is now", () => {
    const rolls = (itemIds: number[]): DropsSource => ({ encounterId: 9101, name: 'Grimtooth', kind: 'boss', itemIds, seen: itemIds.map((id) => seen(id, 1, '2026-12-10', { via: 'roll' })) })
    // Night 1: a raider's rolls make e9101. Night 2: the loot master's corpse matches it by encounter, and a leader takes the corpse's name.
    let docs: LootTableDoc[] = save([barrowMade()], buildPreview(candidates(hollow([rolls([900001])])), setup([barrowMade()]), pickBarrow)).after
    const corpse = candidates(hollow([boss(990001, 'Grimtooth the Test Boss', [900001, 900002], { encounterId: 9101 })]))
    const asked = buildPreview(corpse, setup(docs), pickBarrow).zones[0]?.creatures[0]
    assert.deepEqual([asked?.how, asked?.key, asked?.storeNpcId], ['encounter', 'e9101', 990001])
    docs = save(docs, buildPreview(corpse, setup(docs), { ...pickBarrow, renames: { [asked?.id as string]: true } })).after
    // Night 3: another raider's rolls of the same encounter.
    const night3 = buildPreview(candidates(hollow([rolls([900001, 900003])])), setup(docs), pickBarrow)
    const row = night3.zones[0]?.creatures[0]
    assert.deepEqual([row?.status, row?.how, row?.key, row?.items.map((item) => [item.itemId, item.status, item.ticked])], ['matched', 'encounter', 'e9101', [[900001, 'already', false], [900003, 'new', true]]])
    const after = save(docs, night3).after
    assert.deepEqual(mergeTables([abbey], after, 0).find((zone) => zone.zoneId === BARROW)?.sources.map((source) => [source.key, source.npcId, source.itemIds]), [['e9101', 990001, [900001, 900002, 900003]]])
    // The same when a leader renamed the creature in the editor.
    const renamed = [barrowMade(), sourceDoc(BARROW, 'e9101', 0, { name: 'Grimtooth the Test Boss', kind: 'boss', npcId: 990001, itemIds: [900001], order: 10 })]
    const again = buildPreview(candidates(hollow([rolls([900001, 900003])])), setup(renamed), pickBarrow).zones[0]?.creatures[0]
    assert.deepEqual([again?.status, again?.how, again?.key], ['matched', 'encounter', 'e9101'])
  })

  it('20. a zone first named in the next phase: the current phase write repeats its name, kind and size', () => {
    const docs = [barrowMade(1)]
    const preview = buildPreview(night1, setup(docs), pickBarrow)
    const zone = zoneOf(preview.zones, 'u9901')
    assert.equal(zone.repeatIdentity, true)
    const { first, after } = save(docs, preview)
    assert.deepEqual((first[0] as { create: unknown }).create, { type: 'zone', zoneId: BARROW, phaseNo: 0, name: 'Test Barrow', kind: 'raid', players: 10 })
    const merged = mergeTables([abbey], after, 0).find((candidate) => candidate.zoneId === BARROW)
    assert.deepEqual([merged?.name, merged?.inPhase, merged?.sources.length], ['Test Barrow', true, 2])
  })

  it('never creates a creature document that is there already, also one outside the follow chain the merge leaves out', () => {
    // Phase 1 followed phase 0 when a leader added an item to Grimtooth there (a document with no name); the link was then taken away.
    const docs: LootTableDoc[] = [
      { id: 'p1', type: 'phase', phaseNo: 1, rev: 2 }, barrowMade(), zoneDoc(BARROW, 1, { removed: false }),
      sourceDoc(BARROW, 'n990001', 0, { name: 'Grimtooth the Test Boss', kind: 'boss', npcId: 990001, itemIds: [900001] }),
      sourceDoc(BARROW, 'n990001', 1, { itemIds: [900002] }),
    ]
    const preview = buildPreview(candidates(hollow([boss(990001, 'Grimtooth the Test Boss', [900003])])), setup(docs, { phaseNo: 1 }), pickBarrow)
    const row = preview.zones[0]?.creatures[0]
    assert.equal(row?.status, 'new')
    assert.notEqual(row?.key, 'n990001')
    const first = buildImportSave(preview, setup(docs, { phaseNo: 1 })).first
    assert.deepEqual(first.filter((write) => docs.some((doc) => doc.id === write.id) && 'create' in write), [])
  })

  it('a name that is only tabs or other blanks is never written: a new zone or creature gets a name the rules accept', () => {
    const blank = '\t\t'
    const pasted = candidates(hollow([
      boss(990001, blank, [900001]), boss(990009, 'Grimtooth', [900009]),
      { encounterId: 9105, name: ' ', kind: 'boss', itemIds: [900002], seen: [seen(900002)] },
      { name: '　', kind: 'rare', itemIds: [900003], seen: [seen(900003)] },
    ], { name: '\t' }))
    const make = answers({ zones: { u9901: { make: true } } })
    const preview = buildPreview(pasted, setup([]), make)
    assert.equal(preview.zones[0]?.name, 'Unnamed zone')
    const first = buildImportSave(preview, setup([])).first
    assert.deepEqual(first.map((write) => 'create' in write && 'name' in write.create && write.create.name), ['Unnamed zone', 'NPC 990001', 'Grimtooth', 'Encounter 9105', 'Unnamed creature'])
    // A matched creature is never offered a rename to a blank name.
    const docs = [barrowMade(), sourceDoc(BARROW, 'n990001', 0, { name: 'Grimtooth the Test Boss', kind: 'boss', npcId: 990001, itemIds: [] })]
    const matched = buildPreview(candidates(hollow([boss(990001, blank, [900001])])), setup(docs), pickBarrow)
    assert.equal(matched.zones[0]?.creatures[0]?.differs, undefined)
  })

  it('two creatures the merge keeps apart have rows of their own', () => {
    const trash = (name: string, itemId: number): DropsSource => ({ name, kind: 'trash', itemIds: [itemId], seen: [seen(itemId)] })
    const pasted = candidates(hollow([trash('Test Ölm', 900051), trash('Test ölm', 900052)]))
    assert.equal(pasted[0]?.sources.length, 2)
    for (const zone of [buildPreview(pasted, setup([barrowMade()]), noAnswers()).zones[0], buildPreview(pasted, setup([barrowMade()]), pickBarrow).zones[0]]) {
      const ids = zone?.creatures.map((row) => row.id) ?? []
      assert.equal(new Set(ids).size, 2)
    }
  })

  it('places a new creature right after the creature it follows in the paste, else after the last one', () => {
    const docs = [barrowMade(), sourceDoc(BARROW, 'n990001', 0, { name: 'Grimtooth the Test Boss', kind: 'boss', npcId: 990001, order: 10, itemIds: [900001] }), sourceDoc(BARROW, 'n990009', 0, { name: 'Last Test Boss', kind: 'boss', npcId: 990009, order: 20, itemIds: [900090] })]
    const pasted = candidates(hollow([boss(990001, 'Grimtooth the Test Boss', [900001]), boss(990002, 'Lady Test Ipsum', [900003]), boss(990009, 'Last Test Boss', [900090]), boss(990010, 'After Test Boss', [900091])]))
    const rows = zoneOf(buildPreview(pasted, setup(docs), pickBarrow).zones, 'u9901').creatures
    assert.deepEqual(rows.filter((row) => row.status === 'new').map((row) => [row.name, row.order]), [['Lady Test Ipsum', 11], ['After Test Boss', 21]])
    // New creatures that follow each other at the end are 10 apart, so a leader can still place one between them.
    const fresh = zoneOf(buildPreview(candidates(hollow([boss(990031, 'First New Boss', [900301]), boss(990032, 'Second New Boss', [900302])])), setup(docs), pickBarrow).zones, 'u9901').creatures
    assert.deepEqual(fresh.map((row) => row.order), [30, 40])
  })

  it('the answer keys stay the same when a zone is picked or "same as" is answered', () => {
    const docs = [barrowMade(), sourceDoc(BARROW, 'cgrim1', 0, { name: 'Grimtooth', kind: 'boss', itemIds: [] })]
    const pasted = candidates(hollow([boss(990001, 'Grimtooth the Test Boss', [900001]), boss(990002, 'Lady Test Ipsum', [900003])]))
    const ids = (preview: ReturnType<typeof buildPreview>) => preview.zones.map((zone) => [zone.id, zone.creatures.map((row) => [row.id, row.items.map((item) => item.id)])])
    const unanswered = buildPreview(pasted, setup(docs), noAnswers())
    const picked = buildPreview(pasted, setup(docs), pickBarrow)
    const same = buildPreview(pasted, setup(docs), { ...pickBarrow, creatures: { 'u9901|cn990001': { same: 'cgrim1' } } })
    assert.deepEqual(ids(picked), ids(unanswered))
    assert.deepEqual(ids(same), ids(unanswered))
    assert.deepEqual([same.zones[0]?.creatures[0]?.status, same.zones[0]?.creatures[0]?.key], ['matched', 'cgrim1'])
    assert.deepEqual([picked.zones[0]?.answerKeys, picked.zones[0]?.picks], [['u9901'], [{ answerKey: 'u9901', name: 'Hollow Test Barrow' }]])
    assert.deepEqual([unanswered.zones[0]?.answerKeys, unanswered.zones[0]?.picks], [[], []])
  })

  it('a pick into a zone another pasted zone matched by itself keeps that zone\'s keys, and names the pick', () => {
    const pasted = candidates(hollow([boss(990001, 'Grimtooth the Test Boss', [900001])]), { name: 'Test Barrow', kind: 'raid', players: 10, sources: [boss(990005, 'Boss Five', [900005])] })
    const before = buildPreview(pasted, setup([barrowMade()]), noAnswers())
    assert.deepEqual(before.zones.map((zone) => [zone.id, zone.status]), [['u9901', 'unmatched'], ['utest barrow', 'matched']])
    const after = buildPreview(pasted, setup([barrowMade()]), pickBarrow)
    assert.deepEqual(after.zones.map((zone) => [zone.id, zone.how, zone.answerKeys, zone.picks]), [['utest barrow', 'name', ['u9901'], [{ answerKey: 'u9901', name: 'Hollow Test Barrow' }]]])
    assert.ok(after.zones[0]?.creatures.some((row) => row.id === before.zones[1]?.creatures[0]?.id))
  })

  it('the answers still hold after the first call of a save landed: the second call saves the journal items and the tick', () => {
    const allowed = { journalSaving: true }
    const keep = (extra: Partial<DropsZone>) => mergeDrops([{ schema: 1, id: 'd-test-0006', at: 1797474600, by: 'IntrepidManager/test', journal: 'ForeverDungeonJournal/2.0.3', zones: [{
      name: 'Hollow Test Keep', kind: 'dungeon', players: 5, ...extra, sources: [boss(990011, 'Warden of Fixtures', [900100, 900101, 900102], { seen: [seen(900100)], journal: [900101, 900102] })],
    }] }])
    for (const [pasted, zoneKey, zoneId] of [[keep({ instanceId: 9100 }), 'u9100', 50_009_100], [keep({}), 'uhollow test keep', 61_234_567]] as const) {
      const rowId = `${zoneKey}|cn990011`
      const given = answers({ zones: { [zoneKey]: { make: true, zoneId } }, ticks: { [`${rowId}|900101`]: true, [`${rowId}|900102`]: true } })
      const preview = buildPreview(pasted, setup([], allowed), given)
      assert.deepEqual(created(buildImportSave(preview, setup([], allowed)).first), [zoneDocId(zoneId, 0), sourceDocId(zoneId, 'n990011', 0)])
      // Only the first call landed: the same text and answers find the zone and the creature, and the journal items are still ticked.
      const afterFirst = applyWrites([], buildImportSave(preview, setup([], allowed)).first)
      const retry = buildPreview(pasted, setup(afterFirst, allowed), given)
      const row = retry.zones[0]?.creatures[0]
      assert.deepEqual([retry.zones[0]?.id, retry.zones[0]?.status, row?.id, row?.status], [zoneKey, 'matched', rowId, 'matched'])
      assert.deepEqual(row?.items.map((item) => [item.itemId, item.status, item.ticked]), [[900100, 'already', false], [900101, 'new', true], [900102, 'new', true]])
      const { first, second } = save(afterFirst, retry, allowed)
      assert.deepEqual(first, [])
      assert.deepEqual(second.ticks.map((write) => write.id), [zoneDocId(zoneId, 0)])
      assert.deepEqual(second.journal.flatMap((call) => call.writes).map((write) => [write.id, 'existing' in write && write.changes]), [[sourceDocId(zoneId, 'n990011', 0), { itemIds: [900100, 900101, 900102] }]])
    }
  })

  it("a DungeonJournal list pasted with the game's string for the same dungeon is one zone, made once", () => {
    const pasted = mergeDrops([
      { schema: 1, id: 'd-test-0007', at: 1797474600, by: 'IntrepidManager/test', journal: 'ForeverDungeonJournal/2.0.3', zones: [{ name: 'Hollow Test Keep', kind: 'dungeon', players: 5, sources: [{ npcId: 990012, name: 'Prior of Fixtures', kind: 'boss', itemIds: [900201], journal: [900201] }] }] },
      { schema: 1, id: 'd-test-0008', at: 1797474600, by: 'IntrepidManager/test', zones: [{ name: 'Hollow Test Keep', kind: 'dungeon', players: 5, instanceId: 9100, difficultyId: 1, sources: [boss(990011, 'Warden of Fixtures', [900100])] }] },
    ])
    assert.equal(pasted.length, 2)
    const unanswered = buildPreview(pasted, setup([]), noAnswers())
    assert.deepEqual(unanswered.zones.map((zone) => [zone.id, zone.status, zone.creatures.length]), [['u9100', 'unmatched', 2]])
    const made = buildPreview(pasted, setup([]), answers({ zones: { u9100: { make: true } } }))
    assert.deepEqual(created(buildImportSave(made, setup([])).first), [zoneDocId(50_009_100, 0), sourceDocId(50_009_100, 'n990011', 0)])
  })

  it('a save that stopped says what was saved, what was not sent, and to press Save again', () => {
    const why = 'The change was refused.'
    assert.equal(importStoppedText(12, 5, why), "12 changes were saved and 5 weren't sent. The change was refused. Press Save again to finish: the text and your answers are still here.")
    assert.equal(importStoppedText(1, 1, why), "1 change was saved and 1 wasn't sent. The change was refused. Press Save again to finish: the text and your answers are still here.")
  })

  it("the Log reason names each pasted string once", () => {
    assert.equal(importReason('addon', ['d-test-0001', 'd-test-0002', 'd-test-0001']), 'Imported from the addon (d-test-0001, d-test-0002)')
  })

  it('names a zone of the older raid list as one that cannot hold drop lists, and offers same-kind zones first', () => {
    const preview = buildPreview(night1, setup([barrowMade()], { catalog: [{ id: 'old1', name: 'Hollow Test Barrow', size: 40 }] }), noAnswers())
    assert.equal(preview.zones[0]?.unmatchedWhy, 'catalog')
    assert.deepEqual(preview.zones[0]?.options.map((zone) => zone.name), ['Test Abbey', 'Test Barrow'])
    const raids = buildPreview(candidates(hollow([], { players: 10 })), setup([barrowMade()]), noAnswers())
    assert.deepEqual(raids.zones[0]?.options.map((zone) => zone.name), ['Test Barrow', 'Test Abbey'])
  })
})
