import { beforeEach, describe, test } from 'node:test'
import { deleteDoc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { ANY_ROLE, UID } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildCollection, guildDoc, setUpGuildEmulator } from './support/harness.ts'

setUpGuildEmulator()
beforeEach(() => asAdmin((db) => setDoc(guildDoc(db, 'raids/planned/planning/working'), { schemaVersion: 1, invitations: [], lineups: [] })))

describe('server-owned working raid roster', () => {
  for (const who of ANY_ROLE) {
    test(`${who} can read/list the whole working lineup but never forge or delete it`, async () => {
      const db = dbFor(who)
      const ref = guildDoc(db, 'raids/planned/planning/working')
      await expectAllowed(getDoc(ref))
      await expectAllowed(getDocs(guildCollection(db, 'raids/planned/planning')))
      await expectDenied(setDoc(guildDoc(db, 'raids/planned/planning/forged'), { lineups: [] }))
      await expectDenied(updateDoc(ref, { lineups: [], attendance: true }))
      await expectDenied(deleteDoc(ref))
    })

    describe('independent larger standing assignments', () => {
      for (const [collection, team] of [['teamAssignments20', 'green'], ['teamAssignments40', 'brown']]) {
        for (const who of ANY_ROLE) {
          test(`${who} reads ${collection}, but cannot bypass the capacity/identity callable`, async () => {
            await asAdmin((db) => setDoc(guildDoc(db, `${collection}/character`), { team }))
            const db = dbFor(who)
            const ref = guildDoc(db, `${collection}/character`)
            await expectAllowed(getDoc(ref))
            await expectAllowed(getDocs(guildCollection(db, collection)))
            await expectDenied(setDoc(ref, { team }))
            await expectDenied(deleteDoc(ref))
            await expectDenied(setDoc(guildDoc(db, 'standingTeamLocks/forged'), {}))
          })
        }
        test(`outsiders cannot read ${collection}`, async () => {
          await expectDenied(getDocs(guildCollection(dbFor('stranger'), collection)))
        })
      }
    })
  }
  for (const who of ['anonymous', 'stranger', 'otherGuildLeader'] as const) {
    test(`${who} cannot read or mutate working rosters`, async () => {
      const db = dbFor(who)
      const ref = guildDoc(db, 'raids/planned/planning/working')
      await expectDenied(getDoc(ref))
      await expectDenied(getDocs(guildCollection(db, 'raids/planned/planning')))
      await expectDenied(setDoc(ref, { lineups: [] }))
    })
  }
  test('Removed accounts cannot read a previous lineup', async () => {
    await asAdmin((db) => updateDoc(guildDoc(db, `members/${UID.member}`), { role: 'Removed' }))
    await expectDenied(getDoc(guildDoc(dbFor('member'), 'raids/planned/planning/working')))
  })
})
