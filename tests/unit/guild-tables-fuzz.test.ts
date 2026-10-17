// Fuzz check of the client merge of the drop lists per phase (src/shared/game/guildTables.ts) against an independent reference written from the spec
// (support/mergeReference.ts). Thousands of random captures and documents, every phase from 0 to 7 and the phases the documents sit in, and the
// documents in several orders; the first difference fails with the seed, a shrunken case and both answers. Deterministic: seeded, no Math.random.
// To prove the fuzz can fail, point GUILD_TABLES_MODULE at a changed copy of the module. The write builders are in guild-tables-builders.test.ts.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { LootTableDoc, SourceTableDoc, ZoneTableDoc } from '../../src/shared/game/guildTables.ts'
import type { LootTableCapture } from '../../src/shared/game/lootTables.ts'
import { byZone, firstDiff, firstDropDiff, projectZone, reversed, type Diff } from './support/mergeCompare.ts'
import { referenceDropTables, referenceMerge, type RefZone } from './support/mergeReference.ts'
import { deepFreeze, formatCase, genCase, makeRng, phasesToCheck, shrinkCase, type CaseOptions } from './support/tablesGen.ts'
import { tables } from './support/tablesUnderTest.ts'

const { mergeTables, dropTablesOf, resetCreature } = tables

// What a run covered. A test asserts that each of these is well above zero, so the generator cannot go quiet unnoticed.
const newStats = () => ({
  cases: 0, merges: 0, zones: 0, creatures: 0, byPhase: {} as Record<number, number>,
  captureZonesOutByFromPhase: 0, captureZonesOutByDocument: 0, captureZonesBackByDocument: 0, customZonesExisting: 0, customZonesMissingAtPhase: 0, foreignZoneMerges: 0, laterPhaseDocsIgnored: 0,
  guildCreatures: 0, guildCreaturesNotYetNamed: 0, staleNpcKeys: 0, creaturesRemoved: 0, zoneWideEdited: 0,
  withAdded: 0, withHidden: 0, withGone: 0, hiddenNeverThere: 0, orderTies: 0, nameTies: 0, itemOnTwoCreatures: 0, creatureEmptiedByDedup: 0, noDocAtPhase: 0,
  introducedBeforeNamed: 0,
})
type Stats = ReturnType<typeof newStats>

// All the checks for one case at one phase. The documents come in two orders, as given and (alternately reversed or shuffled by a fixed seed) another;
// the answer must not differ.
function checkAt(captures: LootTableCapture[], docs: LootTableDoc[], phaseNo: number, skipReports: boolean): { diff?: Diff; ref: RefZone[] } {
  const ref = referenceMerge(captures, docs, phaseNo)
  const merged = mergeTables(captures, deepFreeze(docs), phaseNo)
  const diff = firstDiff(ref, merged, skipReports) ?? firstDropDiff(referenceDropTables(captures, docs, phaseNo, ref), dropTablesOf(captures, docs, phaseNo), merged.map((zone) => zone.zoneId))
  if (diff) return { diff, ref }
  const other = deepFreeze(phaseNo % 2 === 0 ? reversed(docs) : makeRng(phaseNo + docs.length).shuffle(docs))
  // (the order of zones with equal names is for the module to settle: the spec has none, see the todo test below)
  const again = mergeTables(captures, other, phaseNo)
  if (JSON.stringify(byZone(merged)) !== JSON.stringify(byZone(again))) {
    return { ref, diff: { path: 'mergeTables depends on the order of the documents', expected: JSON.stringify(byZone(merged).map(projectZone)), actual: JSON.stringify(byZone(again).map(projectZone)) } }
  }
  return { ref }
}

function count(stats: Stats, captures: LootTableCapture[], docs: LootTableDoc[], phaseNo: number, ref: RefZone[]) {
  stats.merges += 1
  stats.byPhase[phaseNo] = (stats.byPhase[phaseNo] ?? 0) + 1
  if (docs.some((doc) => doc.phaseNo > phaseNo)) stats.laterPhaseDocsIgnored += 1
  for (const zone of ref) {
    stats.zones += 1
    const capture = captures.find((candidate) => candidate.zoneId === zone.zoneId)
    const zoneDocs = docs.filter((doc): doc is ZoneTableDoc => doc.type === 'zone' && doc.zoneId === zone.zoneId && doc.phaseNo <= phaseNo)
    const said = zoneDocs.some((doc) => typeof doc.removed === 'boolean')
    if (capture && !zone.inPhase) stats[said ? 'captureZonesOutByDocument' : 'captureZonesOutByFromPhase'] += 1
    if (capture && zone.inPhase && said && capture.fromPhase !== undefined && phaseNo < capture.fromPhase) stats.captureZonesBackByDocument += 1
    if (zone.custom) stats.customZonesExisting += 1
    zone.sources.forEach((source, index) => {
      stats.creatures += 1
      if (!source.builtIn) stats.guildCreatures += 1
      if (!source.builtIn && source.key.startsWith('npc')) stats.staleNpcKeys += 1
      if (!source.builtIn && source.firstDocPhase !== source.firstNamedPhase) stats.introducedBeforeNamed += 1
      if (source.removed) stats.creaturesRemoved += 1
      if (source.added.length > 0) stats.withAdded += 1
      if (source.hidden.length > 0) stats.withHidden += 1
      if (source.gone.length > 0) stats.withGone += 1
      if (!source.hasDoc) stats.noDocAtPhase += 1
      const next = zone.sources[index + 1]
      if (next && next.order === source.order) { stats.orderTies += 1; if (next.name === source.name) stats.nameTies += 1 }
    })
    if (zone.zoneWide.hasDoc) stats.zoneWideEdited += 1
    const visible = zone.sources.filter((source) => !source.removed)
    const all = visible.flatMap((source) => source.items)
    if (new Set(all).size < all.length) stats.itemOnTwoCreatures += 1
    const taken = new Set<number>()
    for (const source of visible) {
      const fresh = source.items.filter((id) => !taken.has(id))
      fresh.forEach((id) => taken.add(id))
      if (source.items.length > 0 && fresh.length === 0) stats.creatureEmptiedByDedup += 1
    }
    for (const source of [...zone.sources, zone.zoneWide]) {
      const doc = docs.find((candidate): candidate is SourceTableDoc => candidate.type === 'source' && candidate.zoneId === zone.zoneId && candidate.key === source.key && candidate.phaseNo === phaseNo)
      if (doc && doc.hiddenItemIds.some((id) => !source.before.includes(id))) stats.hiddenNeverThere += 1
    }
  }
  const shown = new Set(ref.map((zone) => zone.zoneId))
  const customIds = new Set(docs.filter((doc) => doc.zoneId >= 50_000_000 && !captures.some((capture) => capture.zoneId === doc.zoneId) && doc.phaseNo <= phaseNo).map((doc) => doc.zoneId))
  for (const id of customIds) if (!shown.has(id)) stats.customZonesMissingAtPhase += 1
  if (docs.some((doc) => doc.zoneId < 50_000_000 && !captures.some((capture) => capture.zoneId === doc.zoneId) && doc.phaseNo <= phaseNo)) stats.foreignZoneMerges += 1
  const namedLater = new Set(docs.filter((doc) => doc.type === 'source' && doc.name !== undefined && doc.phaseNo > phaseNo).map((doc) => `${doc.zoneId}/${(doc as SourceTableDoc).key}`))
  for (const id of namedLater) if (!ref.some((zone) => zone.sources.some((source) => `${zone.zoneId}/${source.key}` === id))) stats.guildCreaturesNotYetNamed += 1
}

// FUZZ_VERBOSE=1 prints what a run covered.
const report = (label: string, stats: Stats) => { if (process.env.FUZZ_VERBOSE) console.log(`${label}: ${JSON.stringify(stats)}`) }

function describeFailure(label: string, seed: number, captures: LootTableCapture[], docs: LootTableDoc[], phaseNo: number, skipReports: boolean, diff: Diff): string {
  const small = shrinkCase(captures, docs, (c, d) => checkAt(c, d, phaseNo, skipReports).diff?.path === diff.path) // (the same difference, not another one the smaller case happens to show)
  const smallDiff = checkAt(small.captures, small.docs, phaseNo, skipReports).diff ?? diff
  const ref = referenceMerge(small.captures, small.docs, phaseNo)
  const actual = mergeTables(small.captures, small.docs, phaseNo)
  const zoneId = smallDiff.zoneId
  return [
    `${label}: seed ${seed}, lists of phase ${phaseNo}`,
    `first difference: ${smallDiff.path}${zoneId === undefined ? '' : ` (zone ${zoneId})`}`,
    `  reference: ${JSON.stringify(smallDiff.expected)}`,
    `  merge:     ${JSON.stringify(smallDiff.actual)}`,
    'case (shrunken):',
    formatCase(small.captures, small.docs),
    `reference answer${zoneId === undefined ? 's' : ''}: ${JSON.stringify(zoneId === undefined ? ref : ref.filter((zone) => zone.zoneId === zoneId), null, 1)}`,
    `merge answer${zoneId === undefined ? 's' : ''}: ${JSON.stringify((zoneId === undefined ? actual : actual.filter((zone) => zone.zoneId === zoneId)).map(projectZone), null, 1)}`,
  ].join('\n')
}

function runVariant(label: string, firstSeed: number, cases: number, options: CaseOptions, stats: Stats, skipReports = false) {
  for (let index = 0; index < cases; index += 1) {
    const seed = firstSeed + index
    const generated = genCase(makeRng(seed), options)
    stats.cases += 1
    for (const phaseNo of phasesToCheck(generated.docs)) {
      const { diff, ref } = checkAt(generated.captures, generated.docs, phaseNo, skipReports)
      if (diff) assert.fail(describeFailure(label, seed, generated.captures, generated.docs, phaseNo, skipReports, diff))
      count(stats, generated.captures, generated.docs, phaseNo, ref)
    }
  }
}

// Invented data for the small targeted tests below.
const CAPTURE: LootTableCapture = {
  format: 1, zoneId: 900, name: 'Test Hollow', kind: 'dungeon', players: 5, source: 'https://example.test/zone=900', capturedAt: '2026-10-16',
  sources: [{ npcId: 11, name: 'First Warden', kind: 'boss', itemIds: [101, 102] }, { npcId: 12, name: 'Second Warden', kind: 'boss', itemIds: [201] }], zoneWideItemIds: [901],
}
const zoneAt = (zoneId: number, phaseNo: number, name: string): ZoneTableDoc => ({ id: `z${zoneId}_${phaseNo}`, type: 'zone', zoneId, phaseNo, name, kind: 'raid', players: 25, rev: 1 })
const sourceAt = (zoneId: number, key: string, phaseNo: number, fields: Partial<SourceTableDoc> = {}): SourceTableDoc => ({ id: `s${zoneId}_${key}_${phaseNo}`, type: 'source', zoneId, key, phaseNo, itemIds: [], hiddenItemIds: [], rev: 1, ...fields })

describe('mergeTables and dropTablesOf against the reference of the spec', () => {
  it('rules-valid documents: 3000 cases, every phase 0..7 and the phases of the documents', () => {
    const stats = newStats()
    runVariant('valid', 10_000, 3000, {}, stats)
    // The cases must have been rich: every rule of the spec was exercised many times.
    for (const [name, value] of Object.entries(stats)) if (typeof value === 'number') assert.ok(value > 100, `coverage: ${name} = ${value}`)
    for (const phaseNo of [0, 1, 2, 3, 4, 5, 6, 7]) assert.equal(stats.byPhase[phaseNo], 3000, `coverage: phase ${phaseNo}`)
    for (const phaseNo of [8, 9, 10, 11, 12, 13, 31]) assert.ok((stats.byPhase[phaseNo] ?? 0) > 200, `coverage: phase ${phaseNo}`)
    report('valid', stats)
  })

  it('rules-valid documents, dense (a document for most keys in most phases): 1000 cases', () => {
    const stats = newStats()
    runVariant('dense', 200_000, 1000, { density: 0.8 }, stats)
    assert.ok(stats.withHidden > 1000 && stats.withGone > 1000 && stats.creatureEmptiedByDedup > 100)
    report('dense', stats)
  })

  it('documents the rules would refuse (an item in both lists of one document, removed on a capture creature or the zone-wide list): 1500 cases', () => {
    const stats = newStats()
    runVariant('hostile', 400_000, 1500, { hostile: true }, stats, true)
    report('hostile', stats)
  })

  it('first documents that do not set every attribute: the merge answers with sane values and what the spec fixes still holds: 1000 cases', () => {
    let merges = 0
    for (let seed = 600_000; seed < 601_000; seed += 1) {
      const generated = genCase(makeRng(seed), { sparseIntro: true })
      for (const phaseNo of phasesToCheck(generated.docs)) {
        const first = mergeTables(generated.captures, deepFreeze(generated.docs), phaseNo)
        const again = mergeTables(generated.captures, reversed(generated.docs), phaseNo)
        assert.deepEqual(byZone(first), byZone(again), `seed ${seed}, phase ${phaseNo}: the order of the documents changes the answer`)
        for (const zone of first) {
          assert.ok(zone.kind === 'dungeon' || zone.kind === 'raid', `seed ${seed} phase ${phaseNo}: zone ${zone.zoneId} kind ${String(zone.kind)}`)
          assert.ok(Number.isInteger(zone.players) && zone.players >= 1 && zone.players <= 40, `seed ${seed} phase ${phaseNo}: zone ${zone.zoneId} players ${String(zone.players)}`)
          for (const source of zone.sources) {
            assert.ok(['boss', 'rare', 'trash'].includes(source.kind), `seed ${seed} phase ${phaseNo}: ${source.key} kind ${String(source.kind)}`)
            assert.ok(Number.isFinite(source.order), `seed ${seed} phase ${phaseNo}: ${source.key} order ${String(source.order)}`)
          }
        }
        const ref = referenceMerge(generated.captures, generated.docs, phaseNo)
        assert.deepEqual(byZone(first).map((zone) => zone.zoneId), ref.map((zone) => zone.zoneId), `seed ${seed} phase ${phaseNo}: the zones`)
        for (const want of ref) {
          const zone = first.find((candidate) => candidate.zoneId === want.zoneId)!
          assert.equal(zone.inPhase, want.inPhase, `seed ${seed} phase ${phaseNo}: inPhase of ${want.zoneId}`)
          assert.deepEqual(zone.sources.map((source) => source.key).sort(), want.sources.map((source) => source.key).sort(), `seed ${seed} phase ${phaseNo}: the creatures of ${want.zoneId}`)
          for (const wantSource of want.sources) {
            const source = zone.sources.find((candidate) => candidate.key === wantSource.key)!
            assert.deepEqual([source.name, source.itemIds, source.removed], [wantSource.name, wantSource.items, wantSource.removed], `seed ${seed} phase ${phaseNo}: ${wantSource.key} of ${want.zoneId}`)
          }
        }
        merges += 1
      }
    }
    assert.ok(merges > 8000)
  })

  // ---- Where the spec says nothing or the fuzz found a difference: fixed in the module and pinned here, or a choice the reference had to make.

  it('zones with the same name come out in the same order whatever order the documents came in (by zone number)', () => {
    const docs = [zoneAt(50_000_000, 1, 'Twin Vault'), zoneAt(50_000_001, 1, 'Twin Vault')]
    const order = (list: LootTableDoc[]) => mergeTables([], list, 1).map((zone) => zone.zoneId)
    assert.deepEqual(order(docs), order(reversed(docs)))
  })

  it('a creature starts to exist when a document names it, so "Follow the previous phase again" is not offered there even if an unnamed document came first', () => {
    // Spec, Edits in the editor: "Not offered for a creature or zone that starts in this phase". The client never writes a creature document without a name
    // first, so this is reachable only with hand-made documents.
    const docs = [sourceAt(900, 'cq1', 1, { itemIds: [7] }), sourceAt(900, 'cq1', 2, { name: 'Late Guest', kind: 'rare', order: 50 })]
    const zone = mergeTables([CAPTURE], docs, 2).find((candidate) => candidate.zoneId === 900)!
    const guest = zone.sources.find((candidate) => candidate.key === 'cq1')!
    assert.equal(guest.introducedAt, 2)
    assert.equal(resetCreature(zone, guest), null)
  })

  it('an item that a creature and the zone-wide list both came to have stays with the creature in Browse drops, as for two creatures', () => {
    const docs = [sourceAt(900, 'npc12', 1, { itemIds: [901] })] // the zone-wide list has 901 in the capture; the second warden now drops it too
    const drop = dropTablesOf([CAPTURE], docs, 1)[0]
    assert.deepEqual(drop.sources[1].itemIds, [201, 901])
    assert.ok(!drop.zoneWideItemIds.includes(901)) // a creature comes first, the zone-wide list last
  })

  it('SPEC GAP, pinned: a creature of a capture that no document gives a place sits at (its position + 1) * 10, so documents can put others between', () => {
    // The spec says "else the capture's" for the place of a creature, but a capture has no such number. The module (and the reference) use (position + 1) * 10.
    const docs = [sourceAt(900, 'cq1', 1, { name: 'Between', kind: 'rare', order: 15 })]
    const zone = mergeTables([CAPTURE], docs, 1).find((candidate) => candidate.zoneId === 900)!
    assert.deepEqual(zone.sources.map((source) => [source.key, source.order]), [['npc11', 10], ['cq1', 15], ['npc12', 20]])
  })
})
