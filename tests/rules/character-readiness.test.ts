import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteDoc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore'
import { ANY_ROLE, PLAYER_1, PLAYER_2, PLAYER_3, UID, rosterDoc, without } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildCollection, guildDoc, setUpGuildEmulator, stored } from './support/harness.ts'

setUpGuildEmulator()
const flag = (uid = UID.member) => ({ ready: true, updatedBy: uid, updatedAt: serverTimestamp() })
async function link(uid = UID.member) {
  await asAdmin(async (db) => {
    await updateDoc(guildDoc(db, `members/${uid}`), { playerId: PLAYER_1 })
    await updateDoc(guildDoc(db, `roster/${PLAYER_1}`), { linkedUid: uid })
    await updateDoc(guildDoc(db, `roster/${PLAYER_2}`), { mainId: PLAYER_1 })
  })
}

describe('character readiness authorization', () => {
  for (const who of ANY_ROLE) {
    test(`${who} manages own main and direct alt independently`, async () => {
      const uid = UID[who as keyof typeof UID]
      await link(uid)
      await expectAllowed(setDoc(guildDoc(dbFor(who), `characterReadiness/${PLAYER_1}`), flag(uid)))
      await expectAllowed(setDoc(guildDoc(dbFor(who), `characterReadiness/${PLAYER_2}`), { ...flag(uid), ready: false }))
      assert.equal((await stored(`characterReadiness/${PLAYER_1}`))?.ready, true)
      assert.equal((await stored(`characterReadiness/${PLAYER_2}`))?.ready, false)
    })
  }
  for (const who of ['member', 'raidLeader'] as const) {
    test(`${who} cannot manage someone else's or unlinked character`, async () => {
      await link()
      await expectDenied(setDoc(guildDoc(dbFor(who), `characterReadiness/${PLAYER_3}`), flag(UID[who])))
    })
  }
  test('Guild Leader can manage any existing character, but not a missing character', async () => {
    await expectAllowed(setDoc(guildDoc(dbFor('guildLeader'), `characterReadiness/${PLAYER_3}`), flag(UID.guildLeader)))
    await expectDenied(setDoc(guildDoc(dbFor('guildLeader'), 'characterReadiness/missing'), flag(UID.guildLeader)))
  })
  for (const who of ['anonymous', 'stranger', 'otherGuildLeader'] as const) {
    test(`${who} cannot read, list or write`, async () => {
      await expectDenied(getDoc(guildDoc(dbFor(who), `characterReadiness/${PLAYER_1}`)))
      await expectDenied(getDocs(guildCollection(dbFor(who), 'characterReadiness')))
      await expectDenied(setDoc(guildDoc(dbFor(who), `characterReadiness/${PLAYER_1}`), flag()))
    })
  }
  test('Removed member cannot read or write even with a stale reciprocal link', async () => {
    await link()
    await asAdmin((db) => updateDoc(guildDoc(db, `members/${UID.member}`), { role: 'Removed' }))
    await expectDenied(getDocs(guildCollection(dbFor('member'), 'characterReadiness')))
    await expectDenied(setDoc(guildDoc(dbFor('member'), `characterReadiness/${PLAYER_1}`), flag()))
  })
  test('active members can read and list', async () => {
    for (const who of ANY_ROLE) {
      await expectAllowed(getDoc(guildDoc(dbFor(who), `characterReadiness/${PLAYER_1}`)))
      await expectAllowed(getDocs(guildCollection(dbFor(who), 'characterReadiness')))
    }
  })
  for (const broken of ['no-member-link', 'no-roster-link', 'nested-alt', 'linked-alt', 'main-is-alt']) {
    test(`refuses ownership from ${broken}`, async () => {
      await link()
      await asAdmin(async (db) => {
        if (broken === 'no-member-link') await updateDoc(guildDoc(db, `members/${UID.member}`), { playerId: null })
        if (broken === 'no-roster-link') await updateDoc(guildDoc(db, `roster/${PLAYER_1}`), { linkedUid: null })
        if (broken === 'nested-alt') await updateDoc(guildDoc(db, `roster/${PLAYER_2}`), { mainId: PLAYER_3 })
        if (broken === 'linked-alt') await updateDoc(guildDoc(db, `roster/${PLAYER_2}`), { linkedUid: 'another-account' })
        if (broken === 'main-is-alt') await updateDoc(guildDoc(db, `roster/${PLAYER_1}`), { mainId: PLAYER_3 })
      })
      await expectDenied(setDoc(guildDoc(dbFor('member'), `characterReadiness/${PLAYER_2}`), flag()))
    })
  }
  test('renames and main promotion preserve per-character flags and ownership', async () => {
    await link()
    await expectAllowed(setDoc(guildDoc(dbFor('member'), `characterReadiness/${PLAYER_2}`), flag()))
    await asAdmin(async (db) => {
      await setDoc(guildDoc(db, `roster/${PLAYER_1}`), rosterDoc('Oldmain', { mainId: PLAYER_2 }))
      await setDoc(guildDoc(db, `roster/${PLAYER_2}`), rosterDoc('Newmain', { linkedUid: UID.member }))
      await updateDoc(guildDoc(db, `members/${UID.member}`), { playerId: PLAYER_2 })
    })
    assert.equal((await stored(`characterReadiness/${PLAYER_2}`))?.ready, true)
    await expectAllowed(setDoc(guildDoc(dbFor('member'), `characterReadiness/${PLAYER_1}`), { ...flag(), ready: false }))
    await expectAllowed(setDoc(guildDoc(dbFor('member'), `characterReadiness/${PLAYER_2}`), flag()))
  })
})

describe('character readiness shape and lifecycle', () => {
  const invalid = [
    { ...flag(), ready: 'true' },
    { ...flag(), ready: 1 },
    { ...flag(), updatedBy: UID.guildLeader },
    { ...flag(), updatedAt: Timestamp.fromMillis(0) },
    { ...flag(), role: 'Guild Leader' },
    ...['ready', 'updatedBy', 'updatedAt'].map((key) => without(flag(), key)),
  ]
  invalid.forEach((payload, index) => test(`refuses malformed or forged flag ${index}`, async () => {
    await link()
    await expectDenied(setDoc(guildDoc(dbFor('member'), `characterReadiness/${PLAYER_1}`), payload))
  }))
  test('owner can update true to false but nobody can delete', async () => {
    await link()
    await expectAllowed(setDoc(guildDoc(dbFor('member'), `characterReadiness/${PLAYER_1}`), flag()))
    await expectAllowed(setDoc(guildDoc(dbFor('member'), `characterReadiness/${PLAYER_1}`), { ...flag(), ready: false }))
    for (const who of ANY_ROLE) await expectDenied(deleteDoc(guildDoc(dbFor(who), `characterReadiness/${PLAYER_1}`)))
  })
  test('readiness cannot edit roster identity or team assignments', async () => {
    await link()
    await expectDenied(updateDoc(guildDoc(dbFor('member'), `roster/${PLAYER_1}`), { ready: true, name: 'Forged' }))
    await expectDenied(setDoc(guildDoc(dbFor('member'), `teamAssignments/${PLAYER_1}`), { team: 'red' }))
  })
})
