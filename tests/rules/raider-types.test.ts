// raiderTypes/{uid}: a member's own "casual" or "hardcore" setting. Every member can read them; only the owner writes.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteDoc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, type DocumentData } from 'firebase/firestore'
import { ANY_ROLE, BYSTANDER, UID, without } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildCollection, guildDoc, stored, setUpGuildEmulator } from './support/harness.ts'

setUpGuildEmulator()

const typeDoc = (uid: string, overrides: DocumentData = {}): DocumentData => ({ userId: uid, type: 'hardcore', updatedAt: serverTimestamp(), ...overrides })
const seed = (uid: string) => asAdmin((db) => setDoc(guildDoc(db, `raiderTypes/${uid}`), typeDoc(uid, { updatedAt: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')) })))

describe('raiderTypes: writing', () => {
  for (const who of ANY_ROLE) {
    test(`a ${who} can set their own type`, async () => {
      const uid = UID[who as keyof typeof UID]
      await expectAllowed(setDoc(guildDoc(dbFor(who), `raiderTypes/${uid}`), typeDoc(uid, { type: 'casual' })))
      assert.equal((await stored(`raiderTypes/${uid}`))?.type, 'casual')
    })
  }

  test('an existing type can be changed by its owner', async () => {
    await seed(UID.member)
    await expectAllowed(setDoc(guildDoc(dbFor('member'), `raiderTypes/${UID.member}`), typeDoc(UID.member, { type: 'casual' })))
  })

  for (const who of ['anonymous', 'stranger', 'otherGuildLeader'] as const) {
    test(`a ${who} cannot set a type`, async () => {
      const uid = who === 'anonymous' ? 'uid-anonymous' : UID[who]
      await expectDenied(setDoc(guildDoc(dbFor(who), `raiderTypes/${uid}`), typeDoc(uid)))
    })
  }

  const refused: [string, string, DocumentData][] = [
    ["someone else's document", BYSTANDER, typeDoc(UID.member)],
    ['a different userId inside', UID.member, typeDoc(BYSTANDER)],
    ['a type that is not casual or hardcore', UID.member, typeDoc(UID.member, { type: 'elite' })],
    ['no type', UID.member, without(typeDoc(UID.member), 'type')],
    ['an extra field', UID.member, typeDoc(UID.member, { note: 'x' })],
    ['an updatedAt chosen by the client', UID.member, typeDoc(UID.member, { updatedAt: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')) })],
    ['no updatedAt', UID.member, without(typeDoc(UID.member), 'updatedAt')],
  ]
  for (const [what, id, payload] of refused) {
    test(`a document with ${what} is refused`, async () => {
      await expectDenied(setDoc(guildDoc(dbFor('member'), `raiderTypes/${id}`), payload))
    })
  }

  test("a leader cannot change someone else's type", async () => {
    await seed(BYSTANDER)
    await expectDenied(setDoc(guildDoc(dbFor('guildLeader'), `raiderTypes/${BYSTANDER}`), typeDoc(UID.guildLeader)))
    await expectDenied(setDoc(guildDoc(dbFor('guildLeader'), `raiderTypes/${BYSTANDER}`), typeDoc(BYSTANDER, { type: 'casual' })))
  })
})

describe('raiderTypes: reading and deleting', () => {
  test('every member role can read and list; outsiders cannot', async () => {
    await seed(BYSTANDER)
    for (const who of ANY_ROLE) {
      await expectAllowed(getDoc(guildDoc(dbFor(who), `raiderTypes/${BYSTANDER}`)), `${who} reading`)
      await expectAllowed(getDocs(guildCollection(dbFor(who), 'raiderTypes')), `${who} listing`)
    }
    for (const who of ['anonymous', 'stranger', 'otherGuildLeader'] as const) {
      await expectDenied(getDoc(guildDoc(dbFor(who), `raiderTypes/${BYSTANDER}`)), `${who} reading`)
    }
  })

  test('only the owner can delete', async () => {
    await seed(UID.member)
    await expectDenied(deleteDoc(guildDoc(dbFor('guildLeader'), `raiderTypes/${UID.member}`)))
    await expectAllowed(deleteDoc(guildDoc(dbFor('member'), `raiderTypes/${UID.member}`)))
  })
})
