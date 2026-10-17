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
import { PLAYER_1, PLAYER_2, PLAYER_3, UID, priorityDoc } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildDoc, setUpGuildEmulator } from './support/harness.ts'
import { clean, describeChange, entry, entryId, newAwardDoc, newPriorityDoc, stamp } from './support/audit.ts'

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
