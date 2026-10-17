import { beforeEach, describe, test } from 'node:test'
import { deleteDoc, getDocFromServer, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { PERSONAS, UID } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildCollection, guildDoc, setUpGuildEmulator } from './support/harness.ts'

setUpGuildEmulator()
beforeEach(() => asAdmin(async (db) => {
  await setDoc(guildDoc(db, 'characterRequests/own'), { userId: UID.member, status: 'pending' })
  await setDoc(guildDoc(db, 'characterRequests/other'), { userId: UID.raidLeader, status: 'approved' })
}))

describe('private, server-written character requests', () => {
  for (const who of PERSONAS) {
    test(`${who} reads only their own requests unless Guild Leader`, async () => {
      const db = dbFor(who)
      const own = getDocFromServer(guildDoc(db, 'characterRequests/own'))
      if (who === 'member' || who === 'guildLeader') await expectAllowed(own)
      else await expectDenied(own)
      const all = getDocs(guildCollection(db, 'characterRequests'))
      if (who === 'guildLeader') await expectAllowed(all)
      else await expectDenied(all)
      if (who === 'member' || who === 'raidLeader' || who === 'guildLeader') {
        await expectAllowed(getDocs(query(guildCollection(db, 'characterRequests'), where('userId', '==', UID[who]))))
      }
    })
    for (const operation of ['create', 'update', 'delete'] as const) {
      test(`${who} cannot directly ${operation} a request or forge approval`, async () => {
        const db = dbFor(who)
        const ref = guildDoc(db, `characterRequests/${operation === 'create' ? 'new' : 'own'}`)
        await expectDenied(operation === 'create' ? setDoc(ref, { userId: UID.member, status: 'pending' })
          : operation === 'update' ? updateDoc(ref, { status: 'approved', proposed: { name: 'Forged' } }) : deleteDoc(ref))
      })
    }
  }
  test('Removed owner loses even own-request reads', async () => {
    await asAdmin((db) => updateDoc(guildDoc(db, `members/${UID.member}`), { role: 'Removed' }))
    await expectDenied(getDocFromServer(guildDoc(dbFor('member'), 'characterRequests/own')))
    await expectDenied(getDocs(query(guildCollection(dbFor('member'), 'characterRequests'), where('userId', '==', UID.member))))
  })
  test("an account cannot query someone else's requests by knowing their uid", async () => {
    await expectDenied(getDocs(query(guildCollection(dbFor('member'), 'characterRequests'), where('userId', '==', UID.raidLeader))))
  })
})
