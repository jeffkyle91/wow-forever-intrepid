// All guild members may read responses. A member writes only their own response for their linked main
// or a direct alt, before the raid starts. Leaders have no override; no response can be deleted.
import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import { deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore'
import { ANY_ROLE, BYSTANDER, GUILD_ID, OTHER_GUILD_ID, PLAYER_1, PLAYER_2, PLAYER_3, UID, raidDoc, type Persona } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildCollection, guildDoc, setUpGuildEmulator, stored } from './support/harness.ts'

setUpGuildEmulator()
const future = () => Timestamp.fromMillis(Date.now() + 86400000)
const payload = (overrides: Record<string, unknown> = {}) => ({ characterId: PLAYER_1, status: 'accept', updatedAt: serverTimestamp(), ...overrides })
const ref = (who: Persona = 'member', uid = UID.member, raid = 'raid-1') => guildDoc(dbFor(who), `raids/${raid}/signups/${uid}`)
const save = (data: Record<string, unknown> = payload(), who: Persona = 'member', uid = UID.member) => setDoc(ref(who, uid), data)

beforeEach(async () => asAdmin(async (db) => {
  await updateDoc(guildDoc(db, `members/${UID.member}`), { playerId: PLAYER_1 })
  await updateDoc(guildDoc(db, `roster/${PLAYER_1}`), { linkedUid: UID.member })
  await updateDoc(guildDoc(db, `roster/${PLAYER_2}`), { mainId: PLAYER_1 })
  await updateDoc(guildDoc(db, 'raids/raid-1'), { startsAt: future() })
}))

describe('reading raid sign-ups', () => {
  for (const who of ANY_ROLE) {
    test(`${who} can get and list responses`, async () => {
      await expectAllowed(save())
      await expectAllowed(getDoc(ref(who)))
      await expectAllowed(getDocs(guildCollection(dbFor(who), 'raids/raid-1/signups')))
    })
  }
  for (const who of ['anonymous', 'stranger', 'otherGuildLeader'] as const) {
    test(`${who} cannot get or list responses`, async () => {
      await expectAllowed(save())
      await expectDenied(getDoc(ref(who)))
      await expectDenied(getDocs(guildCollection(dbFor(who), 'raids/raid-1/signups')))
    })
  }
  test('another guild path is refused', async () => {
    const db = dbFor('member')
    await expectDenied(getDoc(doc(db, 'guilds', OTHER_GUILD_ID, 'raids', 'raid-1', 'signups', UID.member)))
    await expectDenied(setDoc(doc(db, 'guilds', OTHER_GUILD_ID, 'raids', 'raid-1', 'signups', UID.member), payload()))
  })
})

describe('writing your own response', () => {
  for (const status of ['accept', 'tentative', 'absent', 'late', 'bench']) {
    test(`${status} is accepted, with self bench provenance only for bench`, async () => {
      await expectAllowed(save(payload({ status, ...(status === 'bench' ? { benchKind: 'self' } : {}) })))
      assert.equal((await stored(`raids/raid-1/signups/${UID.member}`))?.status, status)
    })
  }
  test('a response can switch between main and direct alt without adding another account response', async () => {
    await expectAllowed(save())
    await expectAllowed(save(payload({ characterId: PLAYER_2, status: 'late' })))
    const response = await stored(`raids/raid-1/signups/${UID.member}`)
    assert.equal(response?.characterId, PLAYER_2)
    assert.equal(response?.status, 'late')
    assert.equal((await getDocs(guildCollection(dbFor('member'), 'raids/raid-1/signups'))).size, 1)
  })
  test('self-bench can be changed back to Accept without stale bench provenance', async () => {
    await expectAllowed(save(payload({ status: 'bench', benchKind: 'self' })))
    await expectAllowed(save())
    assert.equal((await stored(`raids/raid-1/signups/${UID.member}`))?.benchKind, undefined)
  })
  for (const who of ['raidLeader', 'guildLeader'] as const) {
    test(`${who} can sign up only as themselves, with a linked character`, async () => {
      await asAdmin(async (db) => {
        await updateDoc(guildDoc(db, `members/${UID[who]}`), { playerId: PLAYER_3 })
        await updateDoc(guildDoc(db, `roster/${PLAYER_3}`), { linkedUid: UID[who] })
      })
      await expectAllowed(save(payload({ characterId: PLAYER_3 }), who, UID[who]))
      await expectDenied(save(payload(), who, UID.member))
    })
  }
  for (const who of ['anonymous', 'stranger', 'otherGuildLeader'] as const) {
    test(`${who} cannot write`, async () => { await expectDenied(save(payload(), who)) })
  }
  const refused: [string, Record<string, unknown>][] = [
    ['an unrelated character', { characterId: PLAYER_3 }],
    ['a missing character', { characterId: 'missing' }],
    ['an empty character id', { characterId: '' }],
    ['a non-string character id', { characterId: 42 }],
    ['an unknown status', { status: 'confirmed' }],
    ['a leader bench', { status: 'bench', benchKind: 'leader' }],
    ['a bench without provenance', { status: 'bench' }],
    ['bench provenance on another status', { benchKind: 'self' }],
    ['a client chosen update time', { updatedAt: Timestamp.fromMillis(0) }],
    ['extra identity fields', { userId: UID.member }],
    ['a client supplied team', { team: 'blue' }],
  ]
  for (const [label, changes] of refused) {
    test(`${label} is refused on both create and update`, async () => {
      await expectDenied(save(payload(changes)))
      await expectAllowed(save())
      await expectDenied(save(payload(changes)))
    })
  }
  test('cannot write under another uid or a second document id', async () => {
    await expectDenied(save(payload(), 'member', BYSTANDER))
    await expectDenied(save(payload(), 'member', 'another-response'))
  })
  for (const who of ANY_ROLE) {
    test(`${who} cannot delete a response`, async () => {
      await expectAllowed(save())
      await expectDenied(deleteDoc(ref(who)))
    })
  }
  test('missing required fields are refused', async () => {
    for (const key of ['characterId', 'status', 'updatedAt']) {
      await expectDenied(save(Object.fromEntries(Object.entries(payload()).filter(([field]) => field !== key))))
    }
  })
})

describe('links and cutoff are checked against server state', () => {
  for (const change of [
    { path: `members/${UID.member}`, data: { playerId: null } },
    { path: `roster/${PLAYER_1}`, data: { linkedUid: BYSTANDER } },
    { path: `roster/${PLAYER_1}`, data: { mainId: PLAYER_3 } },
    { path: `roster/${PLAYER_2}`, data: { mainId: PLAYER_3 } },
    { path: `roster/${PLAYER_2}`, data: { linkedUid: BYSTANDER } },
  ]) {
    test(`a changed link at ${change.path} blocks an alt response`, async () => {
      await expectAllowed(save(payload({ characterId: PLAYER_2 })))
      await asAdmin((db) => updateDoc(guildDoc(db, change.path), change.data))
      await expectDenied(save(payload({ characterId: PLAYER_2, status: 'tentative' })))
    })
  }
  for (const change of [
    { status: 'cancelled', cancelReason: 'Not enough players' },
    { startsAt: Timestamp.fromMillis(0) },
  ]) {
    test(`closed raid ${JSON.stringify(change)} refuses create and update`, async () => {
      await expectAllowed(save())
      await asAdmin((db) => updateDoc(guildDoc(db, 'raids/raid-1'), change))
      await expectDenied(save(payload({ status: 'late' })))
      await asAdmin((db) => deleteDoc(guildDoc(db, `raids/raid-1/signups/${UID.member}`)))
      await expectDenied(save())
    })
  }
  test('legacy raids without startsAt and missing raids refuse responses', async () => {
    await asAdmin((db) => setDoc(guildDoc(db, 'raids/raid-1'), raidDoc(UID.raidLeader)))
    await expectDenied(save())
    await expectDenied(setDoc(ref('member', UID.member, 'missing'), payload()))
  })
  test('at exactly the server start instant, even a leader cannot sign up', async () => {
    await asAdmin(async (db) => {
      await updateDoc(guildDoc(db, `members/${UID.raidLeader}`), { playerId: PLAYER_3 })
      await updateDoc(guildDoc(db, `roster/${PLAYER_3}`), { linkedUid: UID.raidLeader })
    })
    const db = dbFor('raidLeader')
    const batch = writeBatch(db)
    batch.set(doc(db, 'guilds', GUILD_ID, 'raids', 'starts-now'), raidDoc(UID.raidLeader, { startsAt: serverTimestamp() }))
    batch.set(ref('raidLeader', UID.raidLeader, 'starts-now'), payload({ characterId: PLAYER_3 }))
    await expectDenied(batch.commit())
  })
})
