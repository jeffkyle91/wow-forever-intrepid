import assert from 'node:assert/strict'
import { after, beforeEach, describe, test } from 'node:test'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { changePlacement, createScheduledRaid, eligibleInvitations, initializePlanning, planningRef, startInstant, synchronizePlanning, synchronizePlanningGuild } from './raidPlanning.js'
import { addAbsence, removeAbsence, saveResponse, synchronizeRaid } from './raids.js'
import { changeStandingTeam } from './standingTeams.js'

const host = process.env.FIRESTORE_EMULATOR_HOST
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Planning tests require a local Firestore emulator.')
const app = initializeApp({ projectId: 'demo-intrepid' }, 'raid-planning-tests')
const db = getFirestore(app)
const guild = db.collection('guilds').doc('planning-guild')
const raid = guild.collection('raids').doc('raid-1')
const plan = () => planningRef(raid).get().then((snapshot) => snapshot.data())
const request = (data, uid = 'leader') => ({ auth: uid ? { uid } : undefined, data: { guildId: guild.id, ...data } })
const initialize = (uid) => initializePlanning(db, request({ raidId: raid.id }, uid))
const respond = (status = 'accept', characterId = 'main') => saveResponse(db, request({ raidId: raid.id, characterId, status }, 'member'))
const move = async (characterId, destination, extra = {}, uid = 'leader') => changePlacement(db, request({
  raidId: raid.id, size: 10, characterId, destination, revision: (await plan()).revision, acknowledgeAbsence: false, ...extra,
}, uid))
const ids = (state, size, team) => state.lineups.find((entry) => entry.size === size).teams.find((entry) => entry.key === team).characterIds
const denied = (promise, code) => assert.rejects(promise, (error) => error.code === code)

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/demo-intrepid/databases/(default)/documents`, { method: 'DELETE' })
  assert.equal(cleared.ok, true)
  const batch = db.batch()
  for (const [uid, role, playerId] of [['leader', 'Guild Leader', null], ['raid-leader', 'Raid Leader', null], ['member', 'Member', 'main'], ['other-member', 'Member', 'other']]) {
    batch.set(guild.collection('members').doc(uid), { role, playerId, displayName: 'Invented Raider' })
  }
  for (const [characterId, fields] of [
    ['main', { name: 'Aldric', linkedUid: 'member' }],
    ['alt', { name: 'Elowen', mainId: 'main' }],
    ['other', { name: 'Briar', linkedUid: 'other-member' }],
    ['unlinked', { name: 'Thistle' }],
  ]) {
    batch.set(guild.collection('roster').doc(characterId), fields)
    batch.set(guild.collection('characterReadiness').doc(characterId), { ready: true })
  }
  batch.set(guild.collection('teamAssignments').doc('main'), { team: 'blue' })
  batch.set(guild.collection('teamAssignments').doc('other'), { team: 'yellow' })
  batch.set(guild.collection('teamAssignments20').doc('main'), { team: 'green' })
  batch.set(guild.collection('teamAssignments20').doc('other'), { team: 'green' })
  batch.set(guild.collection('teamAssignments40').doc('main'), { team: 'brown' })
  batch.set(guild.collection('teamAssignments40').doc('other'), { team: 'brown' })
  batch.set(raid, { date: '2090-06-11', time: '21:00', name: 'Invented Raid', size: 40, zones: [10, 20, 40].map((size) => ({ id: `z${size}`, name: `Invented ${size}`, size })), startsAt: startInstant('2090-06-11', '21:00') })
  await batch.commit()
})
after(() => deleteApp(app))

describe('scheduled raid creation and copying', () => {
  test('creates raid and independent working lineup atomically with zone snapshots', async () => {
    await createScheduledRaid(db, request({ raidId: 'new', date: '2090-06-12', time: '21:00', name: ' New raid ', zones: [{ id: 'z123', name: 'Invented Zone', size: 20 }], description: ' Bring supplies ' }))
    const ref = guild.collection('raids').doc('new')
    assert.equal((await ref.get()).data().description, 'Bring supplies')
    const state = (await planningRef(ref).get()).data()
    assert.equal(state.schemaVersion, 1)
    assert.deepEqual(ids(state, 20, 'green').sort(), ['main', 'other'])
    assert.equal(state.invitations.length, 2)
    await denied(createScheduledRaid(db, request({ raidId: 'new', date: '2090-06-12', time: '21:00', name: 'Again', zones: [{ id: 'z1', name: 'Zone', size: 10 }] })), 'already-exists')
  })
  test('copies unready assigned characters but never invites an alt-only ready account', async () => {
    await guild.collection('characterReadiness').doc('main').set({ ready: false })
    await initialize()
    const state = await plan()
    assert.deepEqual(state.invitations.map((entry) => entry.uid), ['other-member'])
    assert.deepEqual(ids(state, 10, 'blue'), ['main'])
    assert.deepEqual(state.lineups[0].bench, [])
  })
  test('initializing twice and editing standing assignments never recopy existing plans', async () => {
    await initialize()
    const before = await plan()
    await guild.collection('teamAssignments').doc('main').set({ team: 'white' })
    await initialize()
    await synchronizePlanning(db, guild.id, raid.id)
    assert.deepEqual(await plan(), before)
  })
  test('initial absence is excluded without losing invitation', async () => {
    await guild.collection('afkEntries').doc('away').set({ userId: 'member', startDate: '2090-06-11', endDate: '2090-06-11' })
    await initialize()
    const state = await plan()
    assert.deepEqual(ids(state, 10, 'blue'), [])
    assert.equal(state.invitations.length, 2)
  })
  test('initial duplicates within an independent standing team are refused, never silently dropped', async () => {
    await guild.collection('teamAssignments20').doc('alt').set({ team: 'green' })
    await denied(initialize(), 'failed-precondition')
    assert.equal(await plan(), undefined)
  })
  test('no 20/40 assignments means empty larger lineups, never derived from tens', async () => {
    for (const collection of ['teamAssignments20', 'teamAssignments40']) {
      await guild.collection(collection).doc('main').delete()
      await guild.collection(collection).doc('other').delete()
    }
    await guild.collection('teamAssignments').doc('alt').set({ team: 'red' })
    await initialize()
    const state = await plan()
    assert.deepEqual(ids(state, 10, 'blue'), ['main'])
    assert.deepEqual(ids(state, 10, 'red'), ['alt'])
    assert(state.lineups.filter((lineup) => lineup.size !== 10).every((lineup) => lineup.teams.every((team) => !team.characterIds.length)))
  })
  test('initial overcapacity is refused atomically', async () => {
    const batch = db.batch()
    for (let i = 0; i < 10; i++) {
      batch.set(guild.collection('roster').doc(`extra-${i}`), { name: `Invented ${i}` })
      batch.set(guild.collection('teamAssignments').doc(`extra-${i}`), { team: 'blue' })
    }
    await batch.commit()
    await denied(initialize(), 'failed-precondition')
  })

  describe('independent standing teams', () => {
    const assign = (size, characterId, team, uid = 'leader') => changeStandingTeam(db, request({ size, characterId, team }, uid))
    test('each size moves independently and scheduled copies remain unchanged', async () => {
      await initialize()
      await assign(20, 'main', 'pink')
      await assign(40, 'main', null)
      assert.equal((await guild.collection('teamAssignments').doc('main').get()).data().team, 'blue')
      assert.equal((await guild.collection('teamAssignments20').doc('main').get()).data().team, 'pink')
      assert.equal((await guild.collection('teamAssignments40').doc('main').get()).exists, false)
      assert.deepEqual(ids(await plan(), 20, 'green').sort(), ['main', 'other'])
    })
    test('standing teams allow any ready alt without requiring sign-up, but reject a same-player teammate', async () => {
      await assign(20, 'alt', 'pink')
      await denied(assign(20, 'alt', 'green'), 'failed-precondition')
      await denied(assign(40, 'alt', 'brown'), 'failed-precondition')
      await assign(40, 'main', null)
      await assign(40, 'alt', 'brown')
      assert.equal((await guild.collection('teamAssignments40').doc('alt').get()).data().team, 'brown')
    })
    test('unready additions fail but removal is allowed', async () => {
      await guild.collection('characterReadiness').doc('main').set({ ready: false })
      await denied(assign(20, 'main', 'pink'), 'failed-precondition')
      await assign(20, 'main', null)
    })
    test('all sizes enforce capacity, duplicates and allowed keys on server', async () => {
      for (const [size, collection, team] of [[10, 'teamAssignments', 'red'], [20, 'teamAssignments20', 'pink'], [40, 'teamAssignments40', 'brown']]) {
        const batch = db.batch()
        for (let i = 0; i < size; i++) {
          const characterId = `extra-${size}-${i}`
          batch.set(guild.collection('roster').doc(characterId), { name: characterId })
          batch.set(guild.collection(collection).doc(characterId), { team })
        }
        await batch.commit()
        await denied(assign(size, 'main', team), 'failed-precondition')
      }
      await denied(assign(10, 'main', 'green'), 'invalid-argument')
      await denied(assign(20, 'main', 'brown'), 'invalid-argument')
      await denied(assign(40, 'main', 'blue'), 'invalid-argument')
    })
    for (const [size, collection, team] of [[10, 'teamAssignments', 'red'], [20, 'teamAssignments20', 'pink'], [40, 'teamAssignments40', 'brown']]) {
      test(`concurrent standing additions cannot overfill a ${size}-player team`, async () => {
        const batch = db.batch()
        const previous = await guild.collection(collection).where('team', '==', team).get()
        for (const entry of previous.docs) batch.delete(entry.ref)
        for (let i = 0; i < size - 1; i++) {
          const characterId = `seat-${i}`
          batch.set(guild.collection('roster').doc(characterId), { name: `Invented ${i}` })
          batch.set(guild.collection(collection).doc(characterId), { team })
        }
        await batch.commit()
        const results = await Promise.allSettled([assign(size, 'main', team), assign(size, 'other', team)])
        assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
        assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === 'failed-precondition').length, 1)
        assert.equal((await guild.collection(collection).where('team', '==', team).get()).size, size)
      })
    }
    for (const uid of [null, 'stranger', 'member']) {
      test(`${uid} cannot edit any standing size`, async () => {
        for (const [size, team] of [[10, 'red'], [20, 'pink'], [40, 'brown']]) {
          await denied(assign(size, 'main', team, uid), uid ? 'permission-denied' : 'unauthenticated')
        }
      })
    }
    test('Raid Leaders can edit independent standing groups', async () => {
      await assign(20, 'main', 'pink', 'raid-leader')
    })
  })
  for (const patch of [
    { name: '' }, { name: 'x'.repeat(81) }, { zones: [] }, { zones: [{ id: 'a', name: '', size: 10 }] },
    { zones: [{ id: 'a', name: 'Zone', size: 5 }] }, { zones: [{ id: 'a', name: 'Zone', size: 10, hidden: true }] },
    { zones: [null] }, { date: '2090-02-30' }, { time: '25:00' }, { description: 'x'.repeat(501) },
    { zones: [{ id: 'a', name: 'Zone', size: 10 }, { id: 'a', name: 'Zone', size: 10 }] }, { createdBy: 'leader' },
  ]) {
    test(`creation rejects malformed ${JSON.stringify(patch).slice(0, 60)}`, async () => {
      await denied(createScheduledRaid(db, request({ raidId: 'new', name: 'Raid', date: '2090-06-11', time: '21:00', zones: [{ id: 'a', name: 'Zone', size: 10 }], ...patch })), 'invalid-argument')
      assert.equal((await guild.collection('raids').doc('new').get()).exists, false)
    })
  }
  test('Eastern conversion matches winter, summer, repeated hour and rejects DST gap', () => {
    assert.equal(startInstant('2026-12-09', '21:00').toDate().toISOString(), '2026-12-10T02:00:00.000Z')
    assert.equal(startInstant('2026-06-09', '21:00').toDate().toISOString(), '2026-06-10T01:00:00.000Z')
    assert.equal(startInstant('2026-11-01', '01:30').toDate().toISOString(), '2026-11-01T05:30:00.000Z')
    assert.throws(() => startInstant('2026-03-08', '02:30'), /daylight saving/)
  })
})

describe('invitation synchronization', () => {
  test('readiness gains append once, readiness loss retains invite and position', async () => {
    await guild.collection('characterReadiness').doc('main').set({ ready: false })
    await initialize()
    await guild.collection('characterReadiness').doc('main').set({ ready: true })
    await synchronizePlanningGuild(db, guild.id)
    await synchronizePlanningGuild(db, guild.id)
    assert.equal((await plan()).invitations.length, 2)
    await respond()
    await guild.collection('characterReadiness').doc('main').set({ ready: false })
    await synchronizePlanning(db, guild.id, raid.id)
    assert.equal((await plan()).invitations.length, 2)
    assert.deepEqual(ids(await plan(), 10, 'blue'), ['main'])
    assert.equal((await raid.collection('signups').doc('member').get()).data().status, 'accept')
  })
  test('unlinked, removed and foreign main pointers never qualify', () => {
    assert.deepEqual(eligibleInvitations([{ id: 'main', linkedUid: 'elsewhere' }], [{ id: 'member', playerId: 'main', role: 'Member' }], [{ id: 'main', ready: true }]), [])
    assert.deepEqual(eligibleInvitations([{ id: 'main', linkedUid: 'member' }], [{ id: 'member', playerId: 'main', role: 'Removed' }], [{ id: 'main', ready: true }]), [])
  })
  test('cancelled and started plans never receive late additions', async () => {
    await guild.collection('characterReadiness').doc('main').set({ ready: false })
    await initialize()
    await guild.collection('characterReadiness').doc('main').set({ ready: true })
    for (const fields of [{ status: 'cancelled' }, { status: 'scheduled', startsAt: Timestamp.fromMillis(0) }]) {
      await raid.update(fields)
      await synchronizePlanning(db, guild.id, raid.id)
      assert.equal((await plan()).invitations.length, 1)
    }
  })
})

describe('leader placements and safety', () => {
  beforeEach(() => initialize())
  for (const uid of ['leader', 'raid-leader']) {
    test(`${uid} can move before response without changing standing assignments`, async () => {
      await move('main', 'red', {}, uid)
      assert.deepEqual(ids(await plan(), 10, 'red'), ['main'])
      assert.equal((await guild.collection('teamAssignments').doc('main').get()).data().team, 'blue')
      assert.equal((await raid.collection('signups').doc('member').get()).exists, false)
    })
  }
  for (const uid of [null, 'stranger', 'member']) {
    test(`${uid} cannot initialize or edit (no role-preview override)`, async () => {
      await denied(initialize(uid), uid ? 'permission-denied' : 'unauthenticated')
      await denied(move('main', 'red', {}, uid), uid ? 'permission-denied' : 'unauthenticated')
    })
  }
  test('removed leaders are refused', async () => {
    await guild.collection('members').doc('leader').update({ role: 'Removed' })
    await denied(move('main', 'red'), 'permission-denied')
  })
  test('alt response leaves main in place; leader must remove it and select the alt', async () => {
    await respond('accept', 'alt')
    assert.deepEqual(ids(await plan(), 10, 'blue'), ['main'])
    await denied(move('main', 'red'), 'failed-precondition')
    await move('main', 'unassigned')
    await move('alt', 'blue')
    assert.deepEqual(ids(await plan(), 10, 'blue'), ['alt'])
  })
  test('ready alts cannot be placed before the member selects them', async () => {
    await denied(move('alt', 'red'), 'failed-precondition')
    await move('main', 'bench')
    assert.deepEqual((await plan()).lineups[0].bench, ['main'])
  })
  test('unready, foreign-linked or unlinked characters cannot be newly placed; existing can be removed', async () => {
    await guild.collection('characterReadiness').doc('main').set({ ready: false })
    await denied(move('main', 'red'), 'failed-precondition')
    await denied(move('unlinked', 'red'), 'failed-precondition')
    await move('main', 'unassigned')
    assert.deepEqual(ids(await plan(), 10, 'blue'), [])
  })
  test('lineups are independent, and same player can appear on separate individual teams', async () => {
    await respond('accept', 'alt')
    await move('alt', 'red')
    assert.deepEqual(ids(await plan(), 10, 'blue'), ['main'])
    assert.deepEqual(ids(await plan(), 10, 'red'), ['alt'])
    assert.deepEqual(ids(await plan(), 20, 'green').sort(), ['main', 'other'])
    await denied(move('alt', 'blue'), 'failed-precondition')
    await denied(move('alt', 'brown', { size: 40 }), 'failed-precondition')
  })
  test('hard team capacity is checked on the server', async () => {
    const state = await plan()
    const batch = db.batch()
    const extras = Array.from({ length: 10 }, (_, index) => `extra-${index}`)
    for (const characterId of extras) batch.set(guild.collection('roster').doc(characterId), { name: characterId })
    state.lineups[0].teams.find((team) => team.key === 'red').characterIds = extras
    batch.set(planningRef(raid), state)
    await batch.commit()
    await denied(move('main', 'red'), 'failed-precondition')
  })
  test('only sizes present on the raid can be edited', async () => {
    await raid.update({ zones: [{ id: 'ten', name: 'Ten', size: 10 }] })
    await denied(move('main', 'green', { size: 20 }), 'failed-precondition')
  })
  test('stale revisions and concurrent leaders cannot overwrite one another', async () => {
    const revision = (await plan()).revision
    const results = await Promise.allSettled([move('main', 'red', { revision }), move('other', 'white', { revision })])
    assert.equal(results.filter((entry) => entry.status === 'fulfilled').length, 1)
    assert.equal(results.find((entry) => entry.status === 'rejected').reason.code, 'aborted')
  })
  for (const fields of [{ status: 'cancelled' }, { startsAt: Timestamp.fromMillis(0) }]) {
    test(`closed raid rejects editing ${Object.keys(fields)}`, async () => {
      await raid.update(fields)
      await denied(move('main', 'red'), 'failed-precondition')
    })
  }
  test('unsupported identity, bench credit and snapshot fields are rejected', async () => {
    for (const extra of [{ uid: 'member' }, { attendance: true }, { snapshot: {} }, { acknowledgeAbsence: 'true' }]) {
      await denied(move('main', 'red', extra), 'invalid-argument')
    }
  })
})

describe('responses, unavailable dates and placement serialization', () => {
  beforeEach(() => initialize())
  test('Absent clears every lineup and bench; subsequent explicit leader placement persists', async () => {
    await move('main', 'bench')
    await respond('absent')
    let state = await plan()
    assert(state.lineups.every((lineup) => !lineup.bench.includes('main') && lineup.teams.every((team) => !team.characterIds.includes('main'))))
    await denied(move('main', 'blue'), 'failed-precondition')
    await move('main', 'blue', { acknowledgeAbsence: true })
    await synchronizePlanning(db, guild.id, raid.id)
    state = await plan()
    assert.deepEqual(ids(state, 10, 'blue'), ['main'])
    assert.equal((await raid.collection('signups').doc('member').get()).data().status, 'absent')
  })
  test('new absence clears even an earlier explicit Absent override; removal never restores positions', async () => {
    await respond('absent')
    await move('main', 'blue', { acknowledgeAbsence: true })
    const entry = await addAbsence(db, request({ startDate: '2090-06-11', endDate: '2090-06-11' }, 'member'))
    assert.deepEqual(ids(await plan(), 10, 'blue'), [])
    await denied(respond(), 'failed-precondition')
    await move('main', 'red', { acknowledgeAbsence: true })
    await synchronizeRaid(db, guild.id, raid.id)
    assert.deepEqual(ids(await plan(), 10, 'red'), ['main'])
    await removeAbsence(db, request({ entryId: entry.id }, 'member'))
    assert.deepEqual(ids(await plan(), 10, 'red'), ['main'])
    assert.equal((await raid.collection('signups').doc('member').get()).data().status, 'absent')
  })
  test('all other response states preserve existing positions', async () => {
    for (const status of ['accept', 'tentative', 'late', 'bench']) {
      await respond(status)
      assert.deepEqual(ids(await plan(), 10, 'blue'), ['main'])
    }
  })
  test('rescheduling into an absence clears existing positions', async () => {
    await guild.collection('afkEntries').doc('later').set({ userId: 'member', startDate: '2090-06-12', endDate: '2090-06-12' })
    await raid.update({ date: '2090-06-12', startsAt: startInstant('2090-06-12', '21:00') })
    await synchronizeRaid(db, guild.id, raid.id)
    assert.deepEqual(ids(await plan(), 10, 'blue'), [])
  })
  test('concurrent absence and leader placement cannot silently resurrect an unacknowledged position', async () => {
    await Promise.allSettled([respond('absent'), move('main', 'red')])
    const state = await plan()
    assert(state.lineups.every((lineup) => lineup.teams.every((team) => !team.characterIds.includes('main'))))
  })
})
