// How big a batch the rules can evaluate. Firestore limits the document lookups a rule may make (get, exists,
// getAfter): 10 for a single write and 20 for a batch. Rules that look documents up (every role check, the current
// loot phase, the award snapshot check and the audit entry pairing) therefore decide how many writes can travel in one batch.
//
// What the emulator does, and what these tests pin: a lookup of a document that was already looked up in the
// same batch is not charged again, and exists() and get() of one document are charged separately. Whether production
// counts identically is not verified: this is the emulator's behavior. A change to a rule that adds lookups can
// move these limits, which is what these tests are for. The app sends at most 10 audited writes in one batch (src/guildApi.ts),
// well inside the numbers here.
//
// All of these run with the guild's settings document stored, which every guild that has saved its settings has: the loot phase
// rules read it (two lookups for the whole batch). Without it, one more write fits.
import { describe, test } from 'node:test'
import { serverTimestamp, setDoc, writeBatch, type Firestore } from 'firebase/firestore'
import { PLAYER_1, PLAYER_2, PLAYER_3, UID, priorityDoc, rosterDoc } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildDoc, resetData, setUpGuildEmulator } from './support/harness.ts'
import { clean, createTable, describeChange, editTable, entry, entryId, inPhase, newAwardDoc, newPriorityDoc, overlayTableDoc, presenceTableDoc, sourceTableDoc, stamp, storeTable, tableIdOf, zoneTableDoc } from './support/audit.ts'

setUpGuildEmulator()

const WHO = 'raidLeader' as const
const settings = () => asAdmin((db) => setDoc(guildDoc(db, 'settings/general'), { currentPhase: 'Phase', nextPhase: 'Next', phaseHistory: [] }))
const seedPriorities = (prefix: string, count: number) => asAdmin(async (db) => { for (let i = 0; i < count; i++) await setDoc(guildDoc(db, `lootPriorities/${prefix}-${i}`), priorityDoc({ phaseNo: 0 })) })
const reordered = [PLAYER_3, PLAYER_2, PLAYER_1]

function creates(db: Firestore, count: number) {
  const batch = writeBatch(db)
  for (let i = 0; i < count; i++) {
    const id = `new-${i}`
    const fields = newPriorityDoc()
    batch.set(guildDoc(db, `lootPriorities/${id}`), { ...fields, rev: 1, updatedBy: UID[WHO], updatedAt: serverTimestamp() })
    batch.set(guildDoc(db, `auditLog/${entryId('priority', id, 1)}`), clean(entry(WHO, 'priority', id, 1, { action: 'create', item: fields.item, ...describeChange(undefined, fields) })))
  }
  return batch.commit()
}

function edits(db: Firestore, count: number) {
  const batch = writeBatch(db)
  for (let i = 0; i < count; i++) {
    const id = `old-${i}`
    batch.update(guildDoc(db, `lootPriorities/${id}`), { rankedPlayers: reordered, ...stamp(WHO, 1) })
    batch.set(guildDoc(db, `auditLog/${entryId('priority', id, 1)}`), clean(entry(WHO, 'priority', id, 1, { action: 'reorder', item: priorityDoc().item, ...describeChange(priorityDoc(), { rankedPlayers: reordered }) })))
  }
  return batch.commit()
}

function deletes(db: Firestore, count: number) {
  const batch = writeBatch(db)
  const before = priorityDoc({ phaseNo: 0 })
  for (let i = 0; i < count; i++) {
    const id = `old-${i}`
    batch.delete(guildDoc(db, `lootPriorities/${id}`))
    batch.set(guildDoc(db, `auditLog/${entryId('priority', id, 1)}`), clean(entry(WHO, 'priority', id, 1, { action: 'delete', item: before.item, changed: Object.keys(before), before })))
  }
  return batch.commit()
}

// Loot tables: documents of the three kinds, written with their entries. A table is written in the current phase or the next one, so the loot phase is read
// from the settings like for a priority. The widest documents the app writes: a first creature document with all 11 fields (both lists full, the longest
// strings), a first custom zone document with all 7, and an edit of a creature that changes all 7 fields it can.
const widestSource = (i: number) => sourceTableDoc({ key: `k${i}`, phaseNo: 1, name: 'x'.repeat(100), kind: 'trash', npcId: 100_000_000, order: 100_000, itemIds: Array.from({ length: 80 }, (_, n) => n + 1), hiddenItemIds: Array.from({ length: 80 }, (_, n) => n + 1000), removed: true })
const widestZone = (i: number) => zoneTableDoc({ zoneId: 60_000_000 + i, phaseNo: 1, name: 'x'.repeat(100), kind: 'raid', players: 40, removed: false })
const presence = (i: number) => presenceTableDoc({ zoneId: 1000 + i, phaseNo: 1 })
const delta = (i: number) => overlayTableDoc({ key: `npc${100 + i}`, phaseNo: 1 })
const widestEdit = { name: 'y'.repeat(100), kind: 'rare', npcId: 99_999_999, order: 99_999, itemIds: Array.from({ length: 80 }, (_, n) => n + 5000), hiddenItemIds: Array.from({ length: 80 }, (_, n) => n + 9000), removed: false }
const seedTables = async (docs: Record<string, unknown>[]) => { for (const fields of docs) await storeTable(tableIdOf(fields), fields) }

async function tableCreates(db: Firestore, make: (i: number) => Record<string, unknown>, count: number) {
  const batch = writeBatch(db)
  for (let i = 0; i < count; i++) createTable(db, WHO, { into: batch, fields: make(i) })
  return batch.commit()
}

async function tableEdits(db: Firestore, make: (i: number) => Record<string, unknown>, count: number, changes: Record<string, unknown>) {
  const batch = writeBatch(db)
  for (let i = 0; i < count; i++) await editTable(db, WHO, { into: batch, id: tableIdOf(make(i)), changes })
  return batch.commit()
}

/** Awards from a priority: all from the seeded one, or each from its own (`spread-i`). */
function awards(db: Firestore, count: number, spread: boolean) {
  const batch = writeBatch(db)
  for (let i = 0; i < count; i++) {
    const id = `batch-award-${i}`
    const fields = newAwardDoc(spread ? { priorityId: `spread-${i}` } : {})
    batch.set(guildDoc(db, `awards/${id}`), { ...fields, rev: 1, createdBy: UID[WHO], createdAt: serverTimestamp() })
    batch.set(guildDoc(db, `auditLog/${entryId('award', id, 1)}`), clean(entry(WHO, 'award', id, 1, { action: 'create', item: fields.item, ...describeChange(undefined, fields) })))
  }
  return batch.commit()
}

describe('audited priority writes in one batch', () => {
  test('16 new priorities, each with its entry, fit', async () => {
    await settings()
    await expectAllowed(creates(dbFor(WHO), 16))
  })
  // KNOWN GAP: the lookup limit, not a rule, stops the 17th. The app sends at most 10 at a time.
  test('KNOWN GAP: 17 new priorities are refused for lack of lookups', async () => {
    await settings()
    await expectDenied(creates(dbFor(WHO), 17))
  })

  test('16 priority edits, each with its entry, fit', async () => {
    await settings()
    await seedPriorities('old', 16)
    await expectAllowed(edits(dbFor(WHO), 16))
  })
  test('KNOWN GAP: 17 priority edits are refused for lack of lookups', async () => {
    await settings()
    await seedPriorities('old', 17)
    await expectDenied(edits(dbFor(WHO), 17))
  })

  test('16 priority deletes, each with its entry, fit', async () => {
    await settings()
    await seedPriorities('old', 16)
    await expectAllowed(deletes(dbFor(WHO), 16))
  })
  test('KNOWN GAP: 17 priority deletes are refused for lack of lookups', async () => {
    await settings()
    await seedPriorities('old', 17)
    await expectDenied(deletes(dbFor(WHO), 17))
  })
})

describe('audited loot table writes in one batch', () => {
  // The lookups per batch are the role check (2), the loot phase (2, shared) and one per document (exists() of the document for a create, get() for an
  // edit), so 16 fit like priorities, whichever kind of document and however wide the entry: the lookup limit binds long before the expression limit.
  const documents: [string, (i: number) => Record<string, unknown>][] = [
    ['first creature documents with all 11 fields', widestSource],
    ['first custom zone documents with all 7 fields', widestZone],
    ['presence documents of built-in zones', presence],
    ['changes to creatures of the captures', delta],
  ]
  for (const [label, make] of documents) {
    test(`16 new ${label}, each with its entry, fit`, async () => {
      await inPhase(0)
      await expectAllowed(tableCreates(dbFor(WHO), make, 16))
    })
    // KNOWN GAP: the lookup limit, not a rule, stops the 17th. The app sends at most 10 at a time.
    test(`KNOWN GAP: 17 new ${label} are refused for lack of lookups`, async () => {
      await inPhase(0)
      await expectDenied(tableCreates(dbFor(WHO), make, 17))
    })
  }

  test('16 edits that change all 7 fields of a creature (both lists full), each with its entry, fit', async () => {
    await inPhase(0)
    await seedTables(Array.from({ length: 16 }, (_, i) => ({ ...widestSource(i), phaseNo: 1 })))
    await expectAllowed(tableEdits(dbFor(WHO), (i) => widestSource(i), 16, widestEdit))
  })
  test('KNOWN GAP: 17 such edits are refused for lack of lookups', async () => {
    await inPhase(0)
    await seedTables(Array.from({ length: 17 }, (_, i) => ({ ...widestSource(i), phaseNo: 1 })))
    await expectDenied(tableEdits(dbFor(WHO), (i) => widestSource(i), 17, widestEdit))
  })

  test('16 edits of each other kind of document, each with its entry, fit', async () => {
    await inPhase(0)
    await seedTables([...Array.from({ length: 6 }, (_, i) => widestZone(i)), ...Array.from({ length: 5 }, (_, i) => presence(i)), ...Array.from({ length: 5 }, (_, i) => delta(i))])
    const batch = writeBatch(dbFor(WHO))
    for (let i = 0; i < 6; i++) await editTable(dbFor(WHO), WHO, { into: batch, id: tableIdOf(widestZone(i)), changes: { name: 'z', kind: 'dungeon', players: 5, removed: true } })
    for (let i = 0; i < 5; i++) await editTable(dbFor(WHO), WHO, { into: batch, id: tableIdOf(presence(i)), changes: { removed: false } })
    for (let i = 0; i < 5; i++) await editTable(dbFor(WHO), WHO, { into: batch, id: tableIdOf(delta(i)), changes: { itemIds: [1], hiddenItemIds: [2] } })
    await expectAllowed(batch.commit())
  })

  test('8 new documents and 8 edits in one batch fit, and one more of either is refused', async () => {
    const mixed = async (creating: number, editing: number) => {
      await resetData()
      await inPhase(0)
      await seedTables(Array.from({ length: editing }, (_, i) => ({ ...widestSource(100 + i), phaseNo: 1 })))
      const batch = writeBatch(dbFor(WHO))
      for (let i = 0; i < creating; i++) createTable(dbFor(WHO), WHO, { into: batch, fields: widestSource(i) })
      for (let i = 0; i < editing; i++) await editTable(dbFor(WHO), WHO, { into: batch, id: tableIdOf(widestSource(100 + i)), changes: widestEdit })
      return batch.commit()
    }
    await expectAllowed(mixed(8, 8), '8 and 8')
    await expectDenied(mixed(9, 8), '9 and 8')
    await expectDenied(mixed(8, 9), '8 and 9')
  })

  // A guild that never saved its settings has no settings document to read: one lookup less for the phase, so one more document fits.
  test('with no settings stored, 17 new tables fit and 18 are refused', async () => {
    await expectAllowed(tableCreates(dbFor(WHO), widestSource, 17))
    await resetData()
    await expectDenied(tableCreates(dbFor(WHO), widestSource, 18))
  })
  test('with no settings stored, 17 table edits fit and 18 are refused', async () => {
    await seedTables(Array.from({ length: 18 }, (_, i) => ({ ...widestSource(i), phaseNo: 1 })))
    await expectAllowed(tableEdits(dbFor(WHO), widestSource, 17, widestEdit))
    await resetData()
    await seedTables(Array.from({ length: 18 }, (_, i) => ({ ...widestSource(i), phaseNo: 1 })))
    await expectDenied(tableEdits(dbFor(WHO), widestSource, 18, widestEdit))
  })
})

describe('audited awards from a priority in one batch', () => {
  test('14 awards against the same priority, each with its entry, fit', async () => {
    await settings()
    await expectAllowed(awards(dbFor(WHO), 14, false))
  })
  test('KNOWN GAP: 15 awards against the same priority are refused for lack of lookups', async () => {
    await settings()
    await expectDenied(awards(dbFor(WHO), 15, false))
  })

  // Each distinct priority is looked up twice (exists and get), so a batch that spreads awards across priorities runs out sooner. The app
  // records one award at a time.
  test('5 awards, each against a different priority, fit', async () => {
    await settings()
    await seedPriorities('spread', 5)
    await expectAllowed(awards(dbFor(WHO), 5, true))
  })
  test('KNOWN GAP: 6 awards, each against a different priority, are refused for lack of lookups', async () => {
    await settings()
    await seedPriorities('spread', 6)
    await expectDenied(awards(dbFor(WHO), 6, true))
  })
})

// Awards that carry a recipient id (LOOT-003) look the recipient up in the roster, one lookup for each distinct recipient, so fewer fit than awards by name.
// The app records one award at a time (and a receipt through a note is one award and one priority edit).
const ROSTER_IDS = 'ids-budget'
const idLines = Array.from({ length: 12 }, (_, index) => ({ id: `player-${index + 1}`, name: `Test Character ${index + 1}` }))
const seedIdPriority = () => asAdmin(async (db) => {
  for (const line of idLines.slice(3)) await setDoc(guildDoc(db, `roster/${line.id}`), rosterDoc(Number(line.id.slice(7))))
  await setDoc(guildDoc(db, `lootPriorities/${ROSTER_IDS}`), priorityDoc({ phaseNo: 0, rankedPlayers: idLines.map((line) => line.name), rankedIds: idLines.map((line) => line.id) }))
})

/** Awards by id from one priority, all to the first character or each to a different one. */
function idAwards(db: Firestore, count: number, distinct: boolean) {
  const batch = writeBatch(db)
  for (let i = 0; i < count; i++) {
    const id = `id-award-${i}`
    const who = idLines[distinct ? i : 0]!
    const fields = newAwardDoc({ priorityId: ROSTER_IDS, recipient: who.name, recipientId: who.id, prioritySnapshot: idLines.map((line) => line.name), prioritySnapshotIds: idLines.map((line) => line.id) })
    batch.set(guildDoc(db, `awards/${id}`), { ...fields, rev: 1, createdBy: UID[WHO], createdAt: serverTimestamp() })
    batch.set(guildDoc(db, `auditLog/${entryId('award', id, 1)}`), clean(entry(WHO, 'award', id, 1, { action: 'create', item: fields.item, ...describeChange(undefined, fields) })))
  }
  return batch.commit()
}

describe('audited awards by roster id in one batch', () => {
  test('13 awards to the same character fit', async () => {
    await settings()
    await seedIdPriority()
    await expectAllowed(idAwards(dbFor(WHO), 13, false))
  })
  test('KNOWN GAP: 14 awards to the same character are refused for lack of lookups', async () => {
    await settings()
    await seedIdPriority()
    await expectDenied(idAwards(dbFor(WHO), 14, false))
  })
  test('7 awards, each to a different character, fit', async () => {
    await settings()
    await seedIdPriority()
    await expectAllowed(idAwards(dbFor(WHO), 7, true))
  })
  test('KNOWN GAP: 8 awards, each to a different character, are refused for lack of lookups', async () => {
    await settings()
    await seedIdPriority()
    await expectDenied(idAwards(dbFor(WHO), 8, true))
  })
})
