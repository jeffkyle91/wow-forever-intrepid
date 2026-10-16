// Member comments: publicComments (every member can read) and leaderComments (Guild and Raid Leaders and the
// author can read). One document per author, with the author's uid as the id. Only the author writes or deletes.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { Timestamp, deleteDoc, getDoc, getDocs, serverTimestamp, setDoc, type DocumentData } from 'firebase/firestore'
import { ANY_ROLE, BYSTANDER, RAID_STAFF, UID, displayNameOf, without, type Persona } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildCollection, guildDoc, stored, setUpGuildEmulator } from './support/harness.ts'

setUpGuildEmulator()

const CLIENT_TIME = Timestamp.fromDate(new Date('2020-01-01T00:00:00Z'))
const commentDoc = (uid: string, overrides: DocumentData = {}): DocumentData => ({ userId: uid, displayName: displayNameOf(uid), text: 'Back after the weekend.', updatedAt: serverTimestamp(), ...overrides })
const seed = (kind: string, uid: string) => asAdmin((db) => setDoc(guildDoc(db, `${kind}/${uid}`), commentDoc(uid, { updatedAt: CLIENT_TIME })))

for (const kind of ['publicComments', 'leaderComments'] as const) {
  describe(`${kind}: writing`, () => {
    const save = (who: Persona, uid: string, data: DocumentData) => setDoc(guildDoc(dbFor(who), `${kind}/${uid}`), data)

    for (const who of ANY_ROLE) {
      test(`a ${who} can save their own comment`, async () => {
        await expectAllowed(save(who, UID[who as keyof typeof UID], commentDoc(UID[who as keyof typeof UID])))
        assert.equal((await stored(`${kind}/${UID[who as keyof typeof UID]}`))?.text, 'Back after the weekend.')
      })
    }

    test('an existing comment can be replaced by its author', async () => {
      await seed(kind, UID.member)
      await expectAllowed(save('member', UID.member, commentDoc(UID.member, { text: 'Updated' })))
      assert.equal((await stored(`${kind}/${UID.member}`))?.text, 'Updated')
    })

    for (const who of ['anonymous', 'stranger', 'otherGuildLeader'] as const) {
      test(`a ${who} cannot save a comment`, async () => {
        await expectDenied(save(who, who === 'anonymous' ? 'uid-anonymous' : UID[who], commentDoc(who === 'anonymous' ? 'uid-anonymous' : UID[who])))
      })
    }

    const refused: [string, string, DocumentData][] = [
      ["someone else's document", BYSTANDER, commentDoc(UID.member)],
      ["someone else's document, named for them", BYSTANDER, commentDoc(BYSTANDER)],
      ['a different userId inside', UID.member, commentDoc(BYSTANDER)],
      ['a displayName that is not theirs', UID.member, commentDoc(UID.member, { displayName: 'Somebody Else' })],
      ['an extra field', UID.member, commentDoc(UID.member, { pinned: true })],
      ['no displayName', UID.member, without(commentDoc(UID.member), 'displayName')],
      ['an updatedAt chosen by the client', UID.member, commentDoc(UID.member, { updatedAt: CLIENT_TIME })],
      ['no updatedAt', UID.member, without(commentDoc(UID.member), 'updatedAt')],
      ['an empty comment', UID.member, commentDoc(UID.member, { text: '' })],
      ['a blank comment', UID.member, commentDoc(UID.member, { text: '   ' })],
      ['a comment that is not text', UID.member, commentDoc(UID.member, { text: 42 })],
      ['a comment over 300 characters', UID.member, commentDoc(UID.member, { text: 'x'.repeat(301) })],
    ]
    for (const [what, id, payload] of refused) {
      test(`a comment with ${what} is refused`, async () => {
        await expectDenied(save('member', id, payload))
      })
    }

    test('exactly 300 characters is accepted', async () => {
      await expectAllowed(save('member', UID.member, commentDoc(UID.member, { text: 'x'.repeat(300) })))
    })

    test("a leader cannot edit someone else's comment", async () => {
      await seed(kind, BYSTANDER)
      await expectDenied(save('guildLeader', BYSTANDER, commentDoc(UID.guildLeader)))
      await expectDenied(save('guildLeader', BYSTANDER, commentDoc(BYSTANDER)))
    })
  })

  describe(`${kind}: deleting`, () => {
    test('the author can delete their own comment', async () => {
      await seed(kind, UID.member)
      await expectAllowed(deleteDoc(guildDoc(dbFor('member'), `${kind}/${UID.member}`)))
    })

    test("nobody can delete someone else's comment, leaders included", async () => {
      await seed(kind, BYSTANDER)
      for (const who of ['stranger', 'member', 'raidLeader', 'guildLeader'] as const) {
        await expectDenied(deleteDoc(guildDoc(dbFor(who), `${kind}/${BYSTANDER}`)), `${who} deleting`)
      }
    })
  })
}

describe('publicComments: reading', () => {
  test('every member role can read any comment and list them', async () => {
    await seed('publicComments', BYSTANDER)
    for (const who of ANY_ROLE) {
      await expectAllowed(getDoc(guildDoc(dbFor(who), `publicComments/${BYSTANDER}`)), `${who} reading`)
      await expectAllowed(getDocs(guildCollection(dbFor(who), 'publicComments')), `${who} listing`)
    }
  })

  test('a signed-out visitor, a stranger and another guild\'s leader cannot read', async () => {
    await seed('publicComments', BYSTANDER)
    for (const who of ['anonymous', 'stranger', 'otherGuildLeader'] as const) {
      await expectDenied(getDoc(guildDoc(dbFor(who), `publicComments/${BYSTANDER}`)), `${who} reading`)
    }
  })
})

describe('leaderComments: reading', () => {
  test('Guild and Raid Leaders can read anyone\'s and list them', async () => {
    await seed('leaderComments', BYSTANDER)
    for (const who of RAID_STAFF) {
      await expectAllowed(getDoc(guildDoc(dbFor(who), `leaderComments/${BYSTANDER}`)), `${who} reading`)
      await expectAllowed(getDocs(guildCollection(dbFor(who), 'leaderComments')), `${who} listing`)
    }
  })

  test('a Member can read only their own and cannot list the collection', async () => {
    await seed('leaderComments', UID.member)
    await seed('leaderComments', BYSTANDER)
    await expectAllowed(getDoc(guildDoc(dbFor('member'), `leaderComments/${UID.member}`)))
    await expectDenied(getDoc(guildDoc(dbFor('member'), `leaderComments/${BYSTANDER}`)))
    await expectDenied(getDocs(guildCollection(dbFor('member'), 'leaderComments')))
  })

  test("a signed-out visitor, a stranger and another guild's leader cannot read", async () => {
    await seed('leaderComments', BYSTANDER)
    for (const who of ['anonymous', 'stranger', 'otherGuildLeader'] as const) {
      await expectDenied(getDoc(guildDoc(dbFor(who), `leaderComments/${BYSTANDER}`)), `${who} reading`)
    }
  })
})
