import assert from 'node:assert/strict'
import { after, beforeEach, describe, test } from 'node:test'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { addAbsence, removeAbsence, updateAbsence, saveResponse, synchronizeGuild, synchronizeMember, synchronizeRaid } from './raids.js'

const host = process.env.FIRESTORE_EMULATOR_HOST
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Server tests require a local Firestore emulator.')
const app = initializeApp({ projectId: 'demo-intrepid' }, 'raid-server-tests')
const db = getFirestore(app)
const guild = db.collection('guilds').doc('test-guild')
const request = (data, uid = 'test-member') => ({ auth: uid ? { uid } : undefined, data: { guildId: guild.id, ...data } })
const response = (data = {}, uid) => saveResponse(db, request({ raidId: 'raid-1', characterId: 'main', status: 'accept', ...data }, uid))
const absence = (data = {}, uid) => addAbsence(db, request({ startDate: '2090-06-10', endDate: '2090-06-12', ...data }, uid))
const remove = (entryId, uid) => removeAbsence(db, request({ entryId }, uid))
const edit = (entryId, data = {}, uid) => updateAbsence(db, request({ entryId, startDate: '2090-06-20', endDate: '2090-06-22', ...data }, uid))
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
  test('Removed accounts cannot use callables, including with a retained old character link', async () => {
    await response()
    const { id } = await absence()
    await guild.collection('members').doc('test-member').update({ role: 'Removed' })
    await rejected(response(), 'permission-denied')
    await rejected(absence(), 'permission-denied')
    await rejected(remove(id), 'permission-denied')
    await rejected(synchronizeGuild(db, request({})), 'permission-denied')
    assert.equal((await signup().get()).data().status, 'absent')
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

describe('editing owned unavailable ranges', () => {
  const entryRef = (entryId) => guild.collection('afkEntries').doc(entryId)
  const planRef = (raidId) => guild.collection('raids').doc(raidId).collection('planning').doc('working')
  const seedPlan = (raidId) => planRef(raidId).set({
    schemaVersion: 1, revision: 1, invitations: [],
    lineups: [10, 20, 40].map((size) => ({
      size, teams: [{ key: 'invented', name: 'Invented team', characterIds: ['main', 'other'] }], bench: ['alt'],
    })),
  })

  test('updates the same document and preserves ownership, creator and creation timestamp', async () => {
    const { id } = await absence()
    const before = (await entryRef(id).get()).data()
    await edit(id)
    const after = (await entryRef(id).get()).data()
    assert.equal(after.startDate, '2090-06-20')
    assert.equal(after.endDate, '2090-06-22')
    assert.equal(after.userId, before.userId)
    assert.equal(after.displayName, before.displayName)
    assert.ok(after.createdAt.isEqual(before.createdAt))
    assert.ok(after.updatedAt instanceof Timestamp)
    assert.equal((await entryRef(id).parent.get()).size, 1)
    assert.equal((await signup().get()).data().status, 'absent')
    await response({ status: 'tentative' })
  })

  for (const uid of [null, 'outsider', 'test-leader', 'test-raider']) {
    test(`${uid ?? 'anonymous'} cannot edit another member's range`, async () => {
      const { id } = await absence()
      const before = (await entryRef(id).get()).data()
      await rejected(edit(id, {}, uid), uid === null ? 'unauthenticated' : 'permission-denied')
      assert.deepEqual((await entryRef(id).get()).data(), before)
    })
  }

  test('removed accounts, another guild and missing entries cannot be edited', async () => {
    const { id } = await absence()
    await rejected(edit('missing'), 'permission-denied')
    await rejected(edit(id, { guildId: 'another-guild' }), 'permission-denied')
    await guild.collection('members').doc('test-member').update({ role: 'Removed' })
    await rejected(edit(id), 'permission-denied')
  })

  for (const changes of [
    { startDate: '2090-06-23' }, { startDate: '2090-02-30' }, { endDate: '2090-13-01' },
    { startDate: '' }, { endDate: 42 }, { startDate: '2090-6-01' }, { userId: 'test-leader' },
    { displayName: 'Spoofed' }, { createdAt: 0 }, { uid: 'test-leader' }, { entryId: 'path/child' },
  ]) {
    test(`invalid or spoofed edit ${JSON.stringify(changes)} leaves data unchanged`, async () => {
      const { id } = await absence()
      const before = (await entryRef(id).get()).data()
      await rejected(edit(id, changes), 'invalid-argument')
      assert.deepEqual((await entryRef(id).get()).data(), before)
    })
  }

  test('new coverage overrides alt/bench response, clears all sizes and leaves snapshots untouched', async () => {
    const { id } = await absence({ startDate: '2090-07-01', endDate: '2090-07-02' })
    await response({ characterId: 'alt', status: 'bench' })
    await seedPlan('raid-1')
    const snapshotRef = guild.collection('raids').doc('raid-1').collection('snapshots').doc('start')
    await snapshotRef.set({ status: 'complete', marker: 'immutable invented snapshot' })
    const snapshotBefore = (await snapshotRef.get()).data()
    await edit(id, { startDate: '2090-06-11', endDate: '2090-06-11' })
    const saved = (await signup().get()).data()
    assert.equal(saved.status, 'absent')
    assert.equal(saved.characterId, 'alt')
    assert.equal(saved.benchKind, undefined)
    const plan = (await planRef('raid-1').get()).data()
    assert.equal(plan.revision, 2)
    for (const lineup of plan.lineups) {
      assert.deepEqual(lineup.teams[0].characterIds, ['other'])
      assert.deepEqual(lineup.bench, [])
    }
    await edit(id)
    assert.deepEqual((await planRef('raid-1').get()).data(), plan)
    assert.deepEqual((await snapshotRef.get()).data(), snapshotBefore)
  })

  test('old legacy coverage is materialized without affecting raids between disjoint ranges', async () => {
    await response()
    await entryRef('legacy').set({ userId: 'test-member', startDate: '2090-06-11', endDate: '2090-06-11' })
    const gap = guild.collection('raids').doc('gap')
    await gap.set({ date: '2090-06-15', startsAt: Timestamp.fromDate(new Date('2090-06-16T01:00:00Z')) })
    await gap.collection('signups').doc('test-member').set({ characterId: 'main', status: 'late' })
    await edit('legacy')
    assert.equal((await signup().get()).data().status, 'absent')
    assert.equal((await gap.collection('signups').doc('test-member').get()).data().status, 'late')
  })

  test('overlapping events continue blocking responses after one range moves away', async () => {
    const first = await absence()
    const second = await absence({ startDate: '2090-06-11', endDate: '2090-06-11' })
    await edit(first.id)
    await rejected(response(), 'failed-precondition')
    await edit(second.id)
    assert.equal((await signup().get()).data().status, 'absent')
    await response({ status: 'accept' })
    assert.equal((await signup().get()).data().status, 'accept')
  })

  test('an unchanged range is a no-op and shrinking overlapping ranges deduplicates writes', async () => {
    const { id } = await absence()
    const before = (await entryRef(id).get()).data()
    await edit(id, { startDate: before.startDate, endDate: before.endDate })
    assert.deepEqual((await entryRef(id).get()).data(), before)
    await seedPlan('raid-1')
    await edit(id, { startDate: '2090-06-11', endDate: '2090-06-11' })
    assert.equal((await planRef('raid-1').get()).data().revision, 2)
    await rejected(response(), 'failed-precondition')
  })

  test('expanding a range includes both boundaries and leaves other accounts unchanged', async () => {
    const { id } = await absence({ startDate: '2090-06-12', endDate: '2090-06-12' })
    const edge = guild.collection('raids').doc('edge')
    await edge.set({ date: '2090-06-13', startsAt: Timestamp.fromDate(new Date('2090-06-14T01:00:00Z')) })
    await signup().parent.doc('test-leader').set({ characterId: 'other', status: 'accept' })
    await edit(id, { startDate: '2090-06-11', endDate: '2090-06-13' })
    assert.equal((await signup().get()).data().status, 'absent')
    assert.equal((await edge.collection('signups').doc('test-member').get()).data().status, 'absent')
    assert.equal((await signup().parent.doc('test-leader').get()).data().status, 'accept')
  })

  test('unlinked owners can edit without generating a fictitious signup', async () => {
    const { id } = await absence({}, 'test-leader')
    await edit(id, { startDate: '2090-06-11', endDate: '2090-06-11' }, 'test-leader')
    assert.equal((await signup().parent.doc('test-leader').get()).exists, false)
  })

  for (const closed of [{ startsAt: Timestamp.fromMillis(0) }, { status: 'cancelled' }]) {
    test(`edits leave closed raid responses and plans unchanged: ${JSON.stringify(closed)}`, async () => {
      const { id } = await absence({ startDate: '2090-07-01', endDate: '2090-07-02' })
      await response()
      await seedPlan('raid-1')
      await guild.collection('raids').doc('raid-1').update(closed)
      const before = (await planRef('raid-1').get()).data()
      await edit(id, { startDate: '2090-06-11', endDate: '2090-06-11' })
      assert.equal((await signup().get()).data().status, 'accept')
      assert.deepEqual((await planRef('raid-1').get()).data(), before)
    })
  }

  test('an invalid new plan rolls back the range and every response update', async () => {
    const { id } = await absence({ startDate: '2090-07-01', endDate: '2090-07-02' })
    await response()
    await planRef('raid-1').set({ schemaVersion: 99 })
    const before = (await entryRef(id).get()).data()
    await rejected(edit(id, { startDate: '2090-06-11', endDate: '2090-06-11' }), 'failed-precondition')
    assert.deepEqual((await entryRef(id).get()).data(), before)
    assert.equal((await signup().get()).data().status, 'accept')
  })

  test('racing a response with newly covering dates ends Absent', async () => {
    const { id } = await absence({ startDate: '2090-07-01', endDate: '2090-07-02' })
    const results = await Promise.allSettled([response(), edit(id, { startDate: '2090-06-11', endDate: '2090-06-11' })])
    assert.equal(results[1].status, 'fulfilled')
    assert.equal((await signup().get()).data().status, 'absent')
    await rejected(response(), 'failed-precondition')
  })

  test('racing edit and removal cannot resurrect the unavailable document', async () => {
    const { id } = await absence()
    const results = await Promise.allSettled([edit(id), remove(id)])
    assert.equal(results[1].status, 'fulfilled')
    assert.equal((await entryRef(id).get()).exists, false)
    assert.equal((await signup().get()).data().status, 'absent')
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
