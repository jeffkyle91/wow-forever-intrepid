import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { confirmHolds, confirmLabel, countsLine, nothingToSave, zoneChip, zoneOpen } from '../../src/features/loot/dropImportView.ts'
import { buildPreview, noAnswers, type ImportAnswers, type ImportCounts, type ImportSetup } from '../../src/features/loot/dropImport.ts'
import { mergeDrops, type DropsSource, type DropsZone } from '../../src/shared/game/dropsString.ts'
import { zoneDocId, type LootTableDoc, type ZoneTableDoc } from '../../src/shared/game/guildTables.ts'
import type { LootTableCapture } from '../../src/shared/game/lootTables.ts'

// What the drop list import panel (DropImportPanel.tsx) shows and does, as pure functions. Every name and id is invented.

const abbey: LootTableCapture = {
  format: 1, zoneId: 4321, name: 'Test Abbey', kind: 'dungeon', players: 5, source: 'https://example.invalid/abbey', capturedAt: '2026-10-16',
  sources: [{ npcId: 990100, name: 'Abbot of Fixtures', kind: 'boss', itemIds: [900100] }], zoneWideItemIds: [],
}
const zoneDoc = (zoneId: number, phaseNo: number, extra: Partial<ZoneTableDoc> = {}): ZoneTableDoc => ({ id: zoneDocId(zoneId, phaseNo), type: 'zone', zoneId, phaseNo, rev: 1, ...extra })
const setup = (docs: LootTableDoc[], extra: Partial<ImportSetup> = {}): ImportSetup => ({ captures: [abbey], docs, catalog: [], currentPhase: 0, phaseNo: 0, journalSaving: true, canMakeZones: true, ...extra })
const boss = (npcId: number, name: string, itemIds: number[], extra: Partial<DropsSource> = {}): DropsSource => ({ npcId, name, kind: 'boss', itemIds, seen: itemIds.map((itemId) => ({ itemId, n: 1, last: '2026-12-10', via: 'window' as const })), ...extra })
const pasted = (...zones: DropsZone[]) => mergeDrops([{ schema: 1, id: 'd-test-0001', at: 1797474600, by: 'IntrepidManager/test', zones }])
const answers = (patch: Partial<ImportAnswers> = {}): ImportAnswers => ({ ...noAnswers(), ...patch })
const testAbbey = (sources: DropsSource[], extra: Partial<DropsZone> = {}): DropsZone => ({ name: 'Test Abbey', kind: 'dungeon', players: 5, instanceId: 7001, sources, ...extra })
const counts = (patch: Partial<ImportCounts> = {}): ImportCounts => ({ zones: 0, newZones: 0, creatures: 0, newCreatures: 0, items: 0, journalItems: 0, unanswered: 0, ...patch })

describe('the import panel: the confirm step', () => {
  it('names the phase it saves to, with the counts', () => {
    assert.equal(confirmLabel('Phase 4', counts({ zones: 1, creatures: 2, newCreatures: 2, items: 3 })), 'Save to Phase 4: 1 zone, 2 creatures (2 new), 3 items')
  })

  it('has nothing to save when no zone, creature or item is saved', () => {
    assert.equal(nothingToSave(undefined), true)
    assert.equal(nothingToSave(counts({ unanswered: 1 })), true)
    assert.equal(nothingToSave(counts({ zones: 1 })), false)
    assert.equal(nothingToSave(counts({ journalItems: 1 })), false)
  })

  it('closes when the phase or the pasted text changes', () => {
    const open = { phaseNo: 4, text: 'IM1:drops:test' }
    assert.equal(confirmHolds(open, 4, 'IM1:drops:test'), true)
    assert.equal(confirmHolds(open, 3, 'IM1:drops:test'), false)
    assert.equal(confirmHolds(open, 4, 'IM1:drops:other'), false)
    assert.equal(confirmHolds(null, 4, 'IM1:drops:test'), false)
  })
})

describe('the import panel: a zone a leader took out of the phase', () => {
  const docs = [zoneDoc(4321, 0, { removed: true })]
  const night = pasted(testAbbey([boss(990100, 'Abbot of Fixtures', [900102]), boss(990109, 'New Test Boss', [900109])]))

  it('starts open, says it was taken out, and the counts line says it is left out', () => {
    const preview = buildPreview(night, setup(docs), noAnswers())
    const zone = preview.zones[0]
    assert.ok(zone)
    assert.deepEqual([zone.takenOut, zone.zoneTicked], [true, false])
    assert.equal(zoneOpen(zone), true)
    assert.deepEqual(zoneChip(zone, 'Phase 1'), { text: 'taken out of Phase 1', added: false })
    assert.equal(countsLine(preview.counts, preview.zones, 'Phase 1'), '0 zones, 0 creatures, 0 items. 1 zone taken out of Phase 1: left out.')
  })

  it('ticked back, it is counted and no longer left out', () => {
    const preview = buildPreview(night, setup(docs), answers({ ticks: { u7001: true } }))
    const zone = preview.zones[0]
    assert.ok(zone)
    assert.equal(zoneOpen(zone), true)
    assert.deepEqual(zoneChip(zone, 'Phase 1'), { text: 'taken out of Phase 1', added: false })
    assert.equal(countsLine(preview.counts, preview.zones, 'Phase 1'), '1 zone, 2 creatures (1 new), 2 items')
  })

  it('a zone with every row already listed starts closed, and unanswered questions are named', () => {
    const listed = buildPreview(pasted(testAbbey([boss(990100, 'Abbot of Fixtures', [900100])])), setup([zoneDoc(4321, 0, { removed: false })]), noAnswers())
    assert.equal(zoneOpen(listed.zones[0] as NonNullable<typeof listed.zones[0]>), false)
    assert.equal(zoneChip(listed.zones[0] as NonNullable<typeof listed.zones[0]>, 'Phase 1'), undefined)
    assert.equal(countsLine(counts({ unanswered: 2 }), [], 'Phase 1'), '0 zones, 0 creatures, 0 items. 2 questions unanswered: left out.')
  })
})
