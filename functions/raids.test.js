import assert from 'node:assert/strict'
import { after, beforeEach, describe, test } from 'node:test'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { addAbsence, removeAbsence, saveResponse, synchronizeGuild, synchronizeMember, synchronizeRaid } from './raids.js'

const host = process.env.FIRESTORE_EMULATOR_HOST
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Server tests require a local Firestore emulator.')
const app = initializeApp({ projectId: 'demo-intrepid' }, 'raid-server-tests')
const db = getFirestore(app)
const guild = db.collection('guilds').doc('test-guild')
const request = (data, uid = 'test-member') => ({ auth: uid ? { uid } : undefined, data: { guildId: guild.id, ...data } })
const response = (data = {}, uid) => saveResponse(db, request({ raidId: 'raid-1', characterId: 'main', status: 'accept', ...data }, uid))
const absence = (data = {}, uid) => addAbsence(db, request({ startDate: '2090-06-10', endDate: '2090-06-12', ...data }, uid))
const remove = (entryId, uid) => removeAbsence(db, request({ entryId }, uid))
const signup = () => guild.collection('raids').doc('raid-1').collection('signups').doc('test-member')
const rejected = (operation, code) => assert.rejects(operation, (error) => error.code === code)

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/demo-intrepid/databases/(default)/documents`, { method: 'DELETE' })
  assert.equal(cleared.ok, true)
  const batch = db.batch()
  for (const [uid, role] of [['test-member', 'Member'], ['test-leader', 'Guild Leader'], ['test-raider', 'Raid Leader']]) {
    batch.set(guild.collection('members').doc(uid), { role, displayName: 'Invented Member', playerId: uid === 'test-member' ? 'main' : null })
  }
  batch.set(guild.collection('roster').doc('main'), { linkedUid: 'test-member', name: 'Aldric' })
  batch.set(guild.collection('roster').doc('alt'), { mainId: 'main', name: 'Elowen' })
  batch.set(guild.collection('roster').doc('other'), { name: 'Brienne' })
  batch.set(guild.collection('raids').doc('raid-1'), { date: '2090-06-11', startsAt: Timestamp.fromDate(new Date('2090-06-12T01:00:00Z')) })
  await batch.commit()
})
after(() => deleteApp(app))

describe('authenticated response authorization', () => {
  for (const status of ['accept', 'tentative', 'absent', 'late', 'bench']) {
    test(`${status} is saved with server provenance`, async () => {
      await response({ status })
      const saved = (await signup().get()).data()
      assert.equal(saved.status, status)
      assert.ok(saved.updatedAt instanceof Timestamp)
      assert.equal(saved.benchKind, status === 'bench' ? 'self' : undefined)
    })
  }
  test('switching between main and alt keeps one response and removes stale bench provenance', async () => {
    await response({ status: 'bench' })
    await response({ characterId: 'alt', status: 'late' })
    const saved = (await signup().get()).data()
    assert.equal(saved.characterId, 'alt')
    assert.equal(saved.benchKind, undefined)
    assert.equal((await signup().parent.get()).size, 1)
  })
  for (const uid of [null, 'outsider']) {
    test(`${uid ?? 'anonymous'} cannot mutate responses or availability`, async () => {
      const code = uid ? 'permission-denied' : 'unauthenticated'
      await rejected(response({}, uid), code)
      await rejected(absence({}, uid), code)
      await rejected(remove('missing', uid), code)
    })
  }
  test('another guild and unsupported identity, team, timestamp or bench fields are rejected', async () => {
    await rejected(response({ guildId: 'another-guild' }), 'permission-denied')
    for (const extra of [{ uid: 'test-leader' }, { userId: 'test-leader' }, { team: 'blue' }, { updatedAt: 0 }, { benchKind: 'leader' }]) {
      await rejected(response(extra), 'invalid-argument')
    }
  })
  for (const characterId of ['other', 'missing']) {
    test(`cannot respond as ${characterId}`, async () => {
      await rejected(response({ characterId }), 'permission-denied')
    })
  }
  for (const characterId of ['', 42, 'path/child']) {
    test(`invalid character id ${characterId} is rejected`, async () => {
      await rejected(response({ characterId }), 'invalid-argument')
    })
  }
  test('unknown status is rejected', async () => {
    await rejected(response({ status: 'confirmed' }), 'invalid-argument')
  })
  for (const [path, data] of [
    ['members/test-member', { playerId: null }],
    ['roster/main', { linkedUid: 'someone-else' }],
    ['roster/main', { mainId: 'other' }],
    ['roster/alt', { mainId: 'other' }],
    ['roster/alt', { linkedUid: 'someone-else' }],
  ]) {
    test(`changed ownership at ${path} rejects alt response`, async () => {
      await response({ characterId: 'alt' })
      await db.doc(`${guild.path}/${path}`).update(data)
      await assert.rejects(response({ characterId: 'alt' }))
    })
  }
  for (const uid of ['test-leader', 'test-raider']) {
    test(`${uid} may respond as themselves but has no ownership override`, async () => {
      await rejected(response({}, uid), 'failed-precondition')
      await guild.collection('members').doc(uid).update({ playerId: 'other' })
      await guild.collection('roster').doc('other').update({ linkedUid: uid })
      await response({ characterId: 'other' }, uid)
      await rejected(response({ characterId: 'main' }, uid), 'permission-denied')
    })
  }
  for (const change of [{ status: 'cancelled' }, { startsAt: Timestamp.fromMillis(0) }, { startsAt: Timestamp.now() }]) {
    test(`closed raid ${JSON.stringify(change)} rejects responses`, async () => {
      await guild.collection('raids').doc('raid-1').update(change)
      await rejected(response(), 'failed-precondition')
    })
  }
  test('legacy and missing raids cannot accept responses', async () => {
    await guild.collection('raids').doc('raid-1').set({ date: '2090-06-11' })
    await rejected(response(), 'failed-precondition')
    await rejected(response({ raidId: 'missing' }), 'failed-precondition')
  })
})

describe('unavailable dates force and retain Absent', () => {
  test('an event creates Absent on the main even without a previous response', async () => {
    await absence()
    assert.equal((await signup().get()).data().status, 'absent')
    assert.equal((await signup().get()).data().characterId, 'main')
  })
  test('an event overrides a saved alt and strips bench provenance', async () => {
    await response({ characterId: 'alt', status: 'bench' })
    await absence()
    const saved = (await signup().get()).data()
    assert.equal(saved.status, 'absent')
    assert.equal(saved.characterId, 'alt')
    assert.equal(saved.benchKind, undefined)
  })
  for (const date of ['2090-06-10', '2090-06-12']) {
    test(`both inclusive boundaries block responses: ${date}`, async () => {
      await guild.collection('raids').doc('raid-1').update({ date })
      await absence()
      for (const status of ['accept', 'tentative', 'absent', 'late', 'bench']) {
        await rejected(response({ status }), 'failed-precondition')
      }
    })
  }
  test('removing one overlapping event does not unlock; removing the last retains Absent', async () => {
    await response()
    const first = await absence()
    const second = await absence({ startDate: '2090-06-11', endDate: '2090-06-11' })
    await remove(first.id)
    await rejected(response(), 'failed-precondition')
    await remove(second.id)
    assert.equal((await signup().get()).data().status, 'absent')
    await response({ status: 'tentative' })
    assert.equal((await signup().get()).data().status, 'tentative')
  })
  test('legacy unavailable events block writes and retain Absent on removal before backfill', async () => {
    await response()
    await guild.collection('afkEntries').doc('legacy').set({ userId: 'test-member', startDate: '2090-06-11', endDate: '2090-06-11' })
    await rejected(response(), 'failed-precondition')
    await remove('legacy')
    assert.equal((await signup().get()).data().status, 'absent')
  })
  test('dates outside the range and other members are not blocked', async () => {
    await absence({ startDate: '2090-06-12', endDate: '2090-06-15' })
    await absence({}, 'test-leader')
    await response()
    assert.equal((await signup().get()).data().status, 'accept')
  })
  test('absence and response racing leave Absent, regardless of their order', async () => {
    const results = await Promise.allSettled([response(), absence()])
    assert.equal(results[1].status, 'fulfilled')
    assert.equal((await signup().get()).data().status, 'absent')
    await rejected(response(), 'failed-precondition')
  })
  test('no leader may remove another member event or supply an owner', async () => {
    const event = await absence()
    await rejected(remove(event.id, 'test-leader'), 'permission-denied')
    await rejected(absence({ userId: 'test-member' }, 'test-leader'), 'invalid-argument')
  })
  test('unlinked members may mark unavailable without creating a fictitious character response', async () => {
    await absence({}, 'test-leader')
    assert.equal((await signup().parent.doc('test-leader').get()).exists, false)
  })
  for (const changes of [
    { startDate: '2090-06-13' }, { startDate: '2090-02-30' }, { endDate: '2090-13-01' },
    { startDate: '' }, { endDate: 42 }, { startDate: '2090-6-01' }, { createdAt: 0 }, { displayName: 'Spoofed' },
  ]) {
    test(`invalid or spoofed absence ${JSON.stringify(changes)} is rejected`, async () => {
      await rejected(absence(changes), 'invalid-argument')
    })
  }
  test('past and cancelled raids keep their saved response', async () => {
    await response()
    await guild.collection('raids').doc('raid-1').update({ startsAt: Timestamp.fromMillis(0) })
    await absence()
    assert.equal((await signup().get()).data().status, 'accept')
    await guild.collection('raids').doc('raid-1').update({ startsAt: Timestamp.fromDate(new Date('2090-06-12T01:00:00Z')), status: 'cancelled' })
    await absence()
    assert.equal((await signup().get()).data().status, 'accept')
  })
})

describe('scheduled-raid synchronization and existing data', () => {
  test('linking a main after recording unavailable dates materializes Absent', async () => {
    await absence({}, 'test-raider')
    await guild.collection('members').doc('test-raider').update({ playerId: 'other' })
    await guild.collection('roster').doc('other').update({ linkedUid: 'test-raider' })
    await synchronizeMember(db, guild.id, 'test-raider')
    assert.equal((await signup().parent.doc('test-raider').get()).data().status, 'absent')
  })
  test('a newly scheduled or rescheduled raid on unavailable dates is set to Absent', async () => {
    await absence({ startDate: '2090-07-01', endDate: '2090-07-02' })
    await response()
    await guild.collection('raids').doc('raid-1').update({ date: '2090-07-01' })
    await synchronizeRaid(db, guild.id, 'raid-1')
    assert.equal((await signup().get()).data().status, 'absent')
  })
  test('retrying an old trigger after removal cannot overwrite a new response', async () => {
    const entry = await absence()
    await remove(entry.id)
    await response({ status: 'late' })
    await synchronizeRaid(db, guild.id, 'raid-1')
    assert.equal((await signup().get()).data().status, 'late')
  })
  test('only a Guild Leader may backfill existing events, and repetition is safe', async () => {
    await response()
    await guild.collection('afkEntries').doc('legacy').set({ userId: 'test-member', startDate: '2090-06-11', endDate: '2090-06-11' })
    for (const uid of ['test-member', 'test-raider']) await rejected(synchronizeGuild(db, request({}, uid)), 'permission-denied')
    await synchronizeGuild(db, request({}, 'test-leader'))
    const first = (await signup().get()).data()
    await synchronizeGuild(db, request({}, 'test-leader'))
    assert.ok(first.updatedAt.isEqual((await signup().get()).data().updatedAt))
    assert.equal(first.status, 'absent')
  })
})
