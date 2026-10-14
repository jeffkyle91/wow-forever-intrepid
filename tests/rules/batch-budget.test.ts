// How big a batch the rules can evaluate. Firestore limits the document lookups a rule may make (get, exists,
// getAfter): 10 for a single write and 20 for a batch. Rules that look documents up (every role check, and
// the award snapshot check) therefore decide how many writes can travel in one batch.
//
// What the emulator does, and what these tests pin: a lookup of a document that was already looked up in the
// same batch is not charged again, and exists() and get() of one document are charged separately. So a
// batch of awards from a Raid Leader costs two calls for the members doc plus two per distinct priority,
// and it runs out at the tenth distinct priority. Whether production counts identically is not verified:
// this is the emulator's behaviour. A change to a rule that adds lookups can move these limits, which is
// what these tests are for.
import { describe, test } from 'node:test'
import { doc, setDoc, writeBatch, type Firestore } from 'firebase/firestore'
import { awardDoc, priorityDoc, rosterDoc } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildCollection, guildDoc, setUpGuildEmulator } from './support/harness.ts'

setUpGuildEmulator()

const SIZES = [10, 25, 60, 100]

/**
 * A Guild Leader batch shaped like importLocalPreviewData in src/guildApi.ts: roster characters, team
 * assignments, priorities and awards in the ratio 2:2:1:1, `writes` documents in total.
 */
function importShapedBatch(db: Firestore, writes: number) {
  const batch = writeBatch(db)
  for (let i = 0; i < writes; i++) {
    const n = Math.floor(i / 6)
    switch (i % 6) {
      case 0:
      case 1:
        batch.set(guildDoc(db, `roster/import-${n}-${i % 6}`), rosterDoc(`${n}-${i % 6}`))
        break
      case 2:
      case 3:
        batch.set(guildDoc(db, `teamAssignments/import-${n}-${i % 6}`), { team: 'blue' })
        break
      case 4:
        batch.set(guildDoc(db, `lootPriorities/import-${n}`), priorityDoc())
        break
      default:
        batch.set(guildDoc(db, `awards/import-${n}`), awardDoc({ priorityId: `import-${n}` }))
    }
  }
  return batch
}

// match /guilds/{guildId}/... for a Guild Leader: every write looks up the same members doc, which is charged once.
describe('a Guild Leader batch', () => {
  for (const writes of SIZES) {
    test(`${writes} mixed import-style writes are accepted`, async () => {
      await expectAllowed(importShapedBatch(dbFor('guildLeader'), writes).commit())
    })
  }
})

// match /awards/{awardId} for a Raid Leader: every award runs the snapshot check against its priority.
describe('a Raid Leader batch of awards', () => {
  for (const writes of SIZES) {
    test(`${writes} awards against the same priority are accepted`, async () => {
      const db = dbFor('raidLeader')
      const batch = writeBatch(db)
      for (let i = 0; i < writes; i++) batch.set(doc(guildCollection(db, 'awards')), awardDoc())
      await expectAllowed(batch.commit())
    })
  }

  /** `count` awards, each against its own priority, which the test stores first. */
  async function awardsAcrossPriorities(count: number) {
    await asAdmin(async (db) => {
      for (let i = 0; i < count; i++) await setDoc(guildDoc(db, `lootPriorities/spread-${i}`), priorityDoc())
    })
    const db = dbFor('raidLeader')
    const batch = writeBatch(db)
    for (let i = 0; i < count; i++) batch.set(doc(guildCollection(db, 'awards')), awardDoc({ priorityId: `spread-${i}` }))
    return batch.commit()
  }

  test('nine awards, each against a different priority, are accepted', async () => {
    await expectAllowed(awardsAcrossPriorities(9))
  })

  // KNOWN GAP: the snapshot check looks up the award's priority, so a batch that touches ten or more different
  // priorities exceeds the 20-lookup budget and is refused, with the same PERMISSION_DENIED as a real denial.
  // Nothing in the app sends such a batch today (an award is written on its own). A feature that awards many
  // priorities at once as a Raid Leader would hit this. A Guild Leader would not, because that branch skips the check.
  for (const writes of SIZES) {
    test(`KNOWN GAP: ${writes} awards, each against a different priority, are refused`, async () => {
      await expectDenied(awardsAcrossPriorities(writes))
    })
  }
})
