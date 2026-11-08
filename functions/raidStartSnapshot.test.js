import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, afterEach, beforeEach, describe, test } from 'node:test'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import {
  captureRaidStartSnapshot, initialSnapshotCheckpoint, lateSaveMillis, runRaidStartSnapshotSweep, sweepSettleMillis, transientRetryAt,
} from './raidStartSnapshot.js'

const host = process.env.FIRESTORE_EMULATOR_HOST
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Snapshot tests require a local Firestore emulator.')

const app = initializeApp({ projectId: 'demo-intrepid' }, 'raid-start-snapshot-tests')
const db = getFirestore(app)
const start = Timestamp.fromMillis(Date.parse('2026-10-21T01:00:00.000Z'))
const now = Timestamp.fromMillis(Date.parse('2026-10-21T01:05:00.000Z'))
const previousBoundary = Timestamp.fromMillis(start.toMillis() - 24 * 60 * 60 * 1000)
const minutes = (count) => count * 60 * 1000
const later = (at, millis) => Timestamp.fromMillis(at.toMillis() + millis)
// The scheduler runs the sweep every five minutes; this is the run after `now`.
const nextRun = later(now, minutes(5))
let guild
let raid

const emptyTeams = (keys) => keys.map((key) => ({ key, name: key.toUpperCase(), characterIds: [] }))

async function seedRaid({ status, startsAt = start, name = 'Invented Raid', withPlan = true, rev = 0, zones } = {}) {
  const batch = db.batch()
  batch.set(guild.collection('members').doc('member-uid'), { role: 'Member', displayName: 'Invented Member', email: 'private@example.test', playerId: 'main' })
  batch.set(guild.collection('roster').doc('main'), {
    name: 'Aldric', surname: 'Stone', className: 'Warrior', specialization: 'Arms', role: 'Melee', linkedUid: 'member-uid',
  })
  batch.set(guild.collection('roster').doc('alt'), {
    name: 'Elowen', surname: '', className: 'Priest', specialization: 'Holy', role: 'Healer', mainId: 'main',
  })
  batch.set(raid, {
    name, date: '2026-10-20', time: '21:00', size: 40, zones: zones ?? [
      { id: 'zone-10', name: 'Invented Ten', size: 10 },
      { id: 'zone-20', name: 'Invented Twenty', size: 20 },
      { id: 'zone-40', name: 'Invented Forty', size: 40 },
    ],
    startsAt, createdAt: Timestamp.fromMillis(0), ...(status ? { status } : {}), ...(rev ? { rev } : {}),
  })
  if (withPlan) {
    batch.set(raid.collection('planning').doc('working'), {
      schemaVersion: 1, revision: 3, createdAt: Timestamp.fromMillis(10), updatedAt: Timestamp.fromMillis(20),
      initializedBy: 'leader-uid', invitations: [{ uid: 'member-uid', mainId: 'main' }],
      lineups: [
        { size: 10, teams: [{ key: 'blue', name: 'Sky Team', characterIds: ['main'] }, ...emptyTeams(['yellow', 'red', 'white'])], bench: ['alt'] },
        { size: 20, teams: [{ key: 'green', name: 'Emerald Team', characterIds: ['main'] }, ...emptyTeams(['pink'])], bench: [] },
        { size: 40, teams: [{ key: 'brown', name: 'Oak Team', characterIds: ['main'] }], bench: [] },
      ],
    })
    batch.set(raid.collection('signups').doc('member-uid'), { characterId: 'alt', status: 'bench', benchKind: 'self', updatedAt: Timestamp.fromMillis(15) })
  }
  await batch.commit()
}

async function cloneRaid(raidId) {
  const copy = guild.collection('raids').doc(raidId)
  const [raidData, planData, signups] = await Promise.all([
    raid.get(),
    raid.collection('planning').doc('working').get(),
    raid.collection('signups').get(),
  ])
  const batch = db.batch()
  batch.set(copy, raidData.data())
  if (planData.exists) batch.set(copy.collection('planning').doc('working'), planData.data())
  for (const signup of signups.docs) batch.set(copy.collection('signups').doc(signup.id), signup.data())
  await batch.commit()
  return copy
}

function addRaidAudit({ rev = 1, at, changed, before, after: afterFields, action = 'edit' }) {
  return raid.parent.parent.collection('auditLog').doc(`raid_${raid.id}_${rev}`).set({
    at, by: 'leader-uid', byName: 'Invented Leader', targetType: 'raid', targetId: raid.id,
    rev, action, item: 'Invented Raid', changed, before, after: afterFields,
  })
}

async function startSweep(at = now) {
  return runRaidStartSnapshotSweep(db, at)
}

// A database whose transactions fail to read the raid the first `failures` times.
function flakyRaidReads(failures) {
  let remaining = failures
  return new Proxy(db, {
    get(target, property) {
      if (property === 'runTransaction') {
        return (handler, options) => target.runTransaction((transaction) => handler(new Proxy(transaction, {
          get(inner, key) {
            if (key === 'get') return async (ref) => {
              if (remaining > 0 && ref.path === raid.path) {
                remaining--
                throw new Error('Injected transient raid read failure.')
              }
              return transaction.get(ref)
            }
            const value = Reflect.get(inner, key, inner)
            return typeof value === 'function' ? value.bind(inner) : value
          },
        })), options)
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

// RAID-015: a capture that fails before writing anything leaves this small failed record at the snapshot's path, for members to see.
async function assertFailedRecord(code, { name = 'Invented Raid', date = '2026-10-20', startsAt = start } = {}) {
  const record = raid.collection('snapshots').doc('start')
  const data = (await record.get()).data()
  assert.ok(data, 'the failed record exists')
  assert.ok(data.failedAt instanceof Timestamp)
  assert.equal(data.scheduledStartAt.toMillis(), startsAt.toMillis())
  assert.deepEqual({ ...data, failedAt: null, scheduledStartAt: null }, {
    schemaVersion: 1, status: 'failed', failureNotice: true, raidId: raid.id,
    raid: { id: raid.id, name, date }, scheduledStartAt: null, failureCode: code, failedAt: null,
  })
  assert.deepEqual((await record.listCollections()).map((child) => child.id), [])
}

beforeEach(async () => {
  await db.collection('system').doc('raidStartSnapshotSweep').set({ coveredThrough: previousBoundary })
  guild = db.collection('guilds').doc(`snapshot-test-${randomUUID()}`)
  raid = guild.collection('raids').doc('raid-one')
  await seedRaid()
})

afterEach(async () => {
  await db.recursiveDelete(guild)
})

after(() => deleteApp(app))

describe('automatic immutable raid start snapshots', () => {
  test('captures legacy raids without time using the default while preserving startsAt', async () => {
    await raid.update({ time: FieldValue.delete() })
    const result = await startSweep()
    assert.equal(result.captured, 1)
    const manifest = (await raid.collection('snapshots').doc('start').get()).data()
    assert.equal(manifest.status, 'complete')
    assert.equal(manifest.raid.time, '21:00')
    assert.equal(manifest.scheduledStartAt.toMillis(), start.toMillis())
  })

  test('preserves an explicit non-default raid time and its authoritative start instant', async () => {
    await raid.update({ time: '20:30' })
    assert.equal(await captureRaidStartSnapshot(db, guild, raid, raid.id, now), 'captured')
    const manifest = (await raid.collection('snapshots').doc('start').get()).data()
    assert.equal(manifest.raid.time, '20:30')
    assert.equal(manifest.scheduledStartAt.toMillis(), start.toMillis())
  })

  for (const time of [null, 2100, '', '24:00', '21:60', '9:00']) {
    test(`rejects invalid explicit raid time ${JSON.stringify(time)}`, async () => {
      await raid.update({ time })
      assert.equal(await captureRaidStartSnapshot(db, guild, raid, raid.id, now), 'failed')
      await assertFailedRecord('invalid-raid-details')
      const failures = await guild.collection('raidSnapshotFailures').get()
      assert.equal(failures.size, 1)
      assert.equal(failures.docs[0].data().code, 'invalid-raid-details')
    })
  }

  test('bootstraps from the Eastern 9 PM boundary before the previous day across both daylight-saving transitions', () => {
    const springRun = Timestamp.fromDate(new Date('2026-03-08T21:05:00-04:00'))
    const fallRun = Timestamp.fromDate(new Date('2026-11-01T21:05:00-05:00'))
    assert.equal(initialSnapshotCheckpoint(springRun).toDate().toISOString(), '2026-03-08T01:59:59.999Z')
    assert.equal(initialSnapshotCheckpoint(fallRun).toDate().toISOString(), '2026-11-01T00:59:59.999Z')
  })

  test('a transient failure is retried after 5 minutes, then after twice as long each time, at most 6 hours apart', () => {
    const failedAt = Timestamp.fromDate(new Date('2026-11-01T01:30:00-04:00')) // the hour that repeats when daylight saving ends
    const delays = [1, 2, 3, 4, 5, 6, 7, 8, 30].map((attempts) => (transientRetryAt(failedAt, attempts).toMillis() - failedAt.toMillis()) / minutes(1))
    assert.deepEqual(delays, [5, 10, 20, 40, 80, 160, 320, 360, 360])
  })

  test('bootstrap includes already-scheduled raids on the first execution', async () => {
    const overdueRaid = await cloneRaid('raid-yesterday')
    await overdueRaid.update({ startsAt: previousBoundary, date: '2026-10-19' })
    await db.collection('system').doc('raidStartSnapshotSweep').delete()
    const result = await startSweep(later(start, sweepSettleMillis))
    assert.equal(result.captured, 2)
    assert.equal((await db.collection('system').doc('raidStartSnapshotSweep').get()).data().coveredThrough.toMillis(), start.toMillis())
    assert.equal((await raid.collection('snapshots').doc('start').get()).data().status, 'complete')
    assert.equal((await overdueRaid.collection('snapshots').doc('start').get()).data().scheduledStartAt.toMillis(), previousBoundary.toMillis())
  })

  test('captures every applicable lineup, team name, bench, invitation, response and display snapshot', async () => {
    const results = await startSweep()
    assert.equal(results.captured, 1)
    const root = raid.collection('snapshots').doc('start')
    const manifest = (await root.get()).data()
    assert.equal(manifest.status, 'complete')
    assert.equal(manifest.scheduledStartAt.toMillis(), start.toMillis())
    assert.ok(manifest.capturedAt instanceof Timestamp)
    assert.deepEqual(manifest.lineupSizes, [10, 20, 40])

    const ten = (await root.collection('lineups').doc('10').get()).data()
    assert.deepEqual(ten.teams[0], { key: 'blue', name: 'Sky Team', characterIds: ['main'] })
    assert.deepEqual(ten.bench, ['alt'])
    assert.equal((await root.collection('lineups').doc('20').get()).data().teams[0].name, 'Emerald Team')
    assert.equal((await root.collection('lineups').doc('40').get()).data().teams[0].name, 'Oak Team')

    const main = (await root.collection('characters').doc('main').get()).data()
    assert.equal(main.name, 'Aldric')
    assert.equal(main.className, 'Warrior')
    assert.equal(main.specialization, 'Arms')
    assert.equal(main.role, 'Melee')
    assert.deepEqual(main.placements.map((entry) => entry.size), [10, 20, 40])
    const alt = (await root.collection('characters').doc('alt').get()).data()
    assert.equal(alt.mainId, 'main')
    assert.equal(alt.placements[0].bench, true)

    const account = (await root.collection('accounts').doc('member-uid').get()).data()
    assert.equal(account.displayName, 'Invented Member')
    assert.equal(account.invited, true)
    assert.equal(account.invitationMainId, 'main')
    assert.deepEqual(account.signup, { characterId: 'alt', status: 'bench', benchKind: 'self' })
    assert.equal('email' in account, false)
  })

  test('stores a full 120-character 10/20/40 capture without oversized documents', async () => {
    const roster = guild.collection('roster')
    const planRef = raid.collection('planning').doc('working')
    const batch = db.batch()
    for (let index = 0; index < 120; index++) {
      batch.set(roster.doc(`char-${index}`), {
        name: `Invented Raider ${index}`, surname: 'Example', className: 'Warrior', specialization: 'Arms', role: 'Melee',
      })
    }
    const teams10 = ['blue', 'yellow', 'red', 'white'].map((key, group) => ({
      key, name: `Ten ${key}`, characterIds: Array.from({ length: 10 }, (_, i) => `char-${group * 10 + i}`),
    }))
    const teams20 = ['green', 'pink'].map((key, group) => ({
      key, name: `Twenty ${key}`, characterIds: Array.from({ length: 20 }, (_, i) => `char-${40 + group * 20 + i}`),
    }))
    const teams40 = [{ key: 'brown', name: 'Forty Brown', characterIds: Array.from({ length: 40 }, (_, i) => `char-${80 + i}`) }]
    batch.set(planRef, {
      schemaVersion: 1, revision: 1, updatedAt: Timestamp.fromMillis(20), invitations: [{ uid: 'member-uid', mainId: 'main' }],
      lineups: [
        { size: 10, teams: teams10, bench: [] },
        { size: 20, teams: teams20, bench: [] },
        { size: 40, teams: teams40, bench: [] },
      ],
    })
    await batch.commit()

    const results = await startSweep()
    assert.equal(results.captured, 1)
    const root = raid.collection('snapshots').doc('start')
    assert.equal((await root.collection('characters').get()).size, 122)
    assert.equal((await root.collection('lineups').get()).size, 3)
    assert.equal((await root.get()).data().counts.characters, 122)
  })

  test('captures multiple scheduled raid configurations for the same evening', async () => {
    const otherRaid = await cloneRaid('raid-two')
    const results = await startSweep()
    assert.equal(results.captured, 2)
    assert.equal((await raid.collection('snapshots').doc('start').get()).data().status, 'complete')
    assert.equal((await otherRaid.collection('snapshots').doc('start').get()).data().status, 'complete')
  })

  test('catches up bounded windows after a missed daily execution', async () => {
    const checkpointAt = Timestamp.fromDate(new Date('2026-10-01T01:00:00.000Z'))
    const delayedStart = Timestamp.fromMillis(checkpointAt.toMillis() + 8 * 24 * 60 * 60 * 1000)
    const delayedNow = Timestamp.fromMillis(checkpointAt.toMillis() + 10 * 24 * 60 * 60 * 1000)
    await db.collection('system').doc('raidStartSnapshotSweep').set({ coveredThrough: checkpointAt })
    await raid.update({ startsAt: delayedStart })

    const firstCatchup = await startSweep(delayedNow)
    assert.equal(firstCatchup.captured, 0)
    assert.equal(firstCatchup.checkpointAdvanced, true)
    assert.equal((await db.collection('system').doc('raidStartSnapshotSweep').get()).data().coveredThrough.toMillis(),
      checkpointAt.toMillis() + 7 * 24 * 60 * 60 * 1000)

    const secondCatchup = await startSweep(Timestamp.fromMillis(delayedNow.toMillis() + 24 * 60 * 60 * 1000))
    assert.equal(secondCatchup.captured, 1)
    assert.equal((await raid.collection('snapshots').doc('start').get()).data().scheduledStartAt.toMillis(), delayedStart.toMillis())
  })

  test('a transient failure stays queued while other raids progress', async () => {
    const otherRaid = await cloneRaid('raid-two')
    const flakyDb = flakyRaidReads(1)

    const first = await runRaidStartSnapshotSweep(flakyDb, now)
    assert.equal(first.captured, 1)
    assert.equal(first.retry, 1)
    assert.equal(first.checkpointAdvanced, true)
    assert.equal((await otherRaid.collection('snapshots').doc('start').get()).data().status, 'complete')
    assert.equal((await guild.collection('raidSnapshotJobs').doc(raid.id).get()).data().state, 'pending')

    const next = await runRaidStartSnapshotSweep(flakyDb, nextRun)
    assert.equal(next.captured, 1)
    assert.equal((await raid.collection('snapshots').doc('start').get()).data().status, 'complete')
  })

  test('reconstructs changes spanning multiple checkpoint intervals', async () => {
    const nextStart = Timestamp.fromMillis(start.toMillis() + 24 * 60 * 60 * 1000)
    await raid.update({
      description: 'Edited before start',
      startsAt: nextStart,
      date: '2026-10-21',
      status: 'cancelled',
      cancelReason: 'Invented later cancellation',
      rev: 3,
    })
    await addRaidAudit({
      rev: 1, at: Timestamp.fromMillis(start.toMillis() - 1_000), changed: ['description'],
      before: { description: null }, after: { description: 'Edited before start' },
    })
    await addRaidAudit({
      rev: 2, at: Timestamp.fromMillis(start.toMillis() + 500), changed: ['startsAt', 'date'],
      before: { startsAt: start, date: '2026-10-20' },
      after: { startsAt: nextStart, date: '2026-10-21' },
    })
    await addRaidAudit({
      rev: 3, at: Timestamp.fromMillis(start.toMillis() + 700), changed: ['status', 'cancelReason'],
      before: { status: null, cancelReason: null },
      after: { status: 'cancelled', cancelReason: 'Invented later cancellation' }, action: 'cancel',
    })

    const beforeStart = Timestamp.fromMillis(start.toMillis() - 500)
    assert.equal((await startSweep(later(beforeStart, sweepSettleMillis))).captured, 0)
    assert.equal((await db.collection('system').doc('raidStartSnapshotSweep').get()).data().coveredThrough.toMillis(), beforeStart.toMillis())
    const afterChanges = await startSweep(now)
    assert.equal(afterChanges.captured, 1)
    const manifest = (await raid.collection('snapshots').doc('start').get()).data()
    assert.equal(manifest.scheduledStartAt.toMillis(), start.toMillis())
    assert.equal(manifest.raid.description, 'Edited before start')
    assert.equal(manifest.raid.date, '2026-10-20')
  })

  test('retry does not overwrite a published snapshot after source changes', async () => {
    assert.equal(await captureRaidStartSnapshot(db, guild, raid, raid.id, now), 'captured')
    const root = raid.collection('snapshots').doc('start')
    const before = (await root.get()).data()
    await guild.collection('roster').doc('main').update({ name: 'Changed Later' })
    await raid.collection('signups').doc('member-uid').update({ status: 'accept' })
    assert.equal(await captureRaidStartSnapshot(db, guild, raid, raid.id, now), 'complete')
    assert.deepEqual((await root.get()).data(), before)
    assert.equal((await root.collection('characters').doc('main').get()).data().name, 'Aldric')
    assert.equal((await root.collection('accounts').doc('member-uid').get()).data().signup.status, 'bench')
  })

  test('a raid cancelled before its start is not captured', async () => {
    await raid.update({ status: 'cancelled', cancelReason: 'Invented cancellation', rev: 1 })
    await addRaidAudit({
      at: Timestamp.fromMillis(start.toMillis() - 500), changed: ['status', 'cancelReason'],
      before: { status: null, cancelReason: null },
      after: { status: 'cancelled', cancelReason: 'Invented cancellation' }, action: 'cancel',
    })
    const results = await startSweep()
    assert.equal(results.captured, 0)
    assert.equal((await raid.collection('snapshots').doc('start').get()).exists, false)
  })

  test('a cancellation after start cannot erase the due snapshot', async () => {
    await raid.update({ status: 'cancelled', cancelReason: 'Invented late cancellation', rev: 1 })
    await addRaidAudit({
      at: Timestamp.fromMillis(start.toMillis() + 500), changed: ['status', 'cancelReason'],
      before: { status: null, cancelReason: null },
      after: { status: 'cancelled', cancelReason: 'Invented late cancellation' }, action: 'cancel',
    })
    assert.equal((await startSweep()).captured, 1)
    assert.equal((await raid.collection('snapshots').doc('start').get()).data().status, 'complete')
  })

  test('a cancellation exactly at the scheduled boundary cannot erase the due snapshot', async () => {
    await raid.update({ status: 'cancelled', rev: 1 })
    await addRaidAudit({
      at: start, changed: ['status'], before: { status: 'scheduled' }, after: { status: 'cancelled' },
    })
    assert.equal((await startSweep()).captured, 1)
    const manifest = (await raid.collection('snapshots').doc('start').get()).data()
    assert.equal(manifest.status, 'complete')
    assert.equal(manifest.scheduledStartAt.toMillis(), start.toMillis())
  })

  // RAID-019: Mark Complete sets status 'complete' once the raid has started. The raid was held, so its start snapshot must still be captured.
  test('a raid marked complete after its start is still captured by the daily sweep', async () => {
    await raid.update({ status: 'complete', rev: 1 })
    await addRaidAudit({
      at: Timestamp.fromMillis(start.toMillis() + 60_000), changed: ['status'], before: { status: null }, after: { status: 'complete' }, action: 'complete',
    })
    assert.equal((await startSweep()).captured, 1)
    const manifest = (await raid.collection('snapshots').doc('start').get()).data()
    assert.equal(manifest.status, 'complete')
    assert.equal(manifest.scheduledStartAt.toMillis(), start.toMillis())
    assert.equal(manifest.raid.name, 'Invented Raid')
    assert.equal((await guild.collection('raidSnapshotJobs').doc(raid.id).get()).data().state, 'complete')
  })

  test('a raid marked complete exactly at its start is still captured', async () => {
    await raid.update({ status: 'complete', rev: 1 })
    await addRaidAudit({ at: start, changed: ['status'], before: { status: null }, after: { status: 'complete' }, action: 'complete' })
    assert.equal((await startSweep()).captured, 1)
    assert.equal((await raid.collection('snapshots').doc('start').get()).data().scheduledStartAt.toMillis(), start.toMillis())
  })

  test('a raid recorded as complete with no audit history (written outside the app) is still captured', async () => {
    await raid.update({ status: 'complete' })
    assert.equal(await captureRaidStartSnapshot(db, guild, raid, raid.id, now), 'captured')
    assert.equal((await raid.collection('snapshots').doc('start').get()).data().status, 'complete')
  })

  test('a raid marked complete and then undone is captured once', async () => {
    await raid.update({ status: 'scheduled', rev: 2 })
    await addRaidAudit({ rev: 1, at: Timestamp.fromMillis(start.toMillis() + 30_000), changed: ['status'], before: { status: null }, after: { status: 'complete' }, action: 'complete' })
    await addRaidAudit({ rev: 2, at: Timestamp.fromMillis(start.toMillis() + 90_000), changed: ['status'], before: { status: 'complete' }, after: { status: 'scheduled' } })
    assert.equal((await startSweep()).captured, 1)
    assert.equal((await startSweep(nextRun)).captured, 0)
    assert.equal((await raid.collection('snapshots').doc('start').get()).data().scheduledStartAt.toMillis(), start.toMillis())
  })

  test('a raid marked complete between a transient failure and its retry is captured by the retry', async () => {
    const flakyDb = flakyRaidReads(1)
    const first = await runRaidStartSnapshotSweep(flakyDb, now)
    assert.equal(first.retry, 1)
    assert.equal((await guild.collection('raidSnapshotJobs').doc(raid.id).get()).data().state, 'pending')
    assert.equal((await raid.collection('snapshots').doc('start').get()).exists, false)

    // A leader marks it complete after the failed attempt and before the next run.
    await raid.update({ status: 'complete', rev: 1 })
    await addRaidAudit({
      at: Timestamp.fromMillis(now.toMillis() + 60_000), changed: ['status'], before: { status: null }, after: { status: 'complete' }, action: 'complete',
    })
    const retry = await runRaidStartSnapshotSweep(flakyDb, nextRun)
    assert.equal(retry.captured, 1)
    const manifest = (await raid.collection('snapshots').doc('start').get()).data()
    assert.equal(manifest.status, 'complete')
    assert.equal(manifest.scheduledStartAt.toMillis(), start.toMillis())
    assert.equal((await guild.collection('raidSnapshotJobs').doc(raid.id).get()).data().state, 'complete')
  })

  test('a post-start reschedule is recovered from raid audit history', async () => {
    const nextStart = Timestamp.fromMillis(start.toMillis() + 24 * 60 * 60 * 1000)
    await raid.update({ startsAt: nextStart, date: '2026-10-21', rev: 1 })
    await addRaidAudit({
      at: Timestamp.fromMillis(start.toMillis() + 500), changed: ['startsAt', 'date'],
      before: { startsAt: start, date: '2026-10-20' },
      after: { startsAt: nextStart, date: '2026-10-21' },
    })
    assert.equal((await startSweep()).captured, 1)
    const manifest = (await raid.collection('snapshots').doc('start').get()).data()
    assert.equal(manifest.scheduledStartAt.toMillis(), start.toMillis())
    assert.equal(manifest.raid.date, '2026-10-20')
  })

  test('a response changed after the due start is reported instead of publishing a false history', async () => {
    const nextStart = Timestamp.fromMillis(start.toMillis() + 24 * 60 * 60 * 1000)
    await raid.update({ startsAt: nextStart, date: '2026-10-21', rev: 1 })
    await addRaidAudit({
      at: Timestamp.fromMillis(start.toMillis() + 500), changed: ['startsAt', 'date'],
      before: { startsAt: start, date: '2026-10-20' },
      after: { startsAt: nextStart, date: '2026-10-21' },
    })
    await raid.collection('signups').doc('member-uid').update({ status: 'accept', updatedAt: Timestamp.fromMillis(start.toMillis() + 600) })
    assert.equal((await startSweep()).failed, 1)
    await assertFailedRecord('signup-changed-after-start') // the date at the start, not the later one
    assert.equal((await guild.collection('raidSnapshotFailures').get()).size, 1)
  })

  test('a working roster changed after the due start is reported instead of publishing a false history', async () => {
    const nextStart = Timestamp.fromMillis(start.toMillis() + 24 * 60 * 60 * 1000)
    await raid.update({ startsAt: nextStart, date: '2026-10-21', rev: 1 })
    await addRaidAudit({
      at: Timestamp.fromMillis(start.toMillis() + 500), changed: ['startsAt', 'date'],
      before: { startsAt: start, date: '2026-10-20' },
      after: { startsAt: nextStart, date: '2026-10-21' },
    })
    await raid.collection('planning').doc('working').update({ revision: 2, updatedAt: Timestamp.fromMillis(start.toMillis() + 600) })
    assert.equal((await startSweep()).failed, 1)
    await assertFailedRecord('working-roster-changed-after-start')
    assert.equal((await guild.collection('raidSnapshotFailures').get()).size, 1)
  })

  test('a reschedule before the old start does not capture the abandoned time', async () => {
    const nextStart = Timestamp.fromMillis(start.toMillis() + 24 * 60 * 60 * 1000)
    await raid.update({ startsAt: nextStart, date: '2026-10-21', rev: 1 })
    await addRaidAudit({
      at: Timestamp.fromMillis(start.toMillis() - 500), changed: ['startsAt', 'date'],
      before: { startsAt: start, date: '2026-10-20' },
      after: { startsAt: nextStart, date: '2026-10-21' },
    })
    assert.equal((await startSweep()).captured, 0)
    assert.equal((await raid.collection('snapshots').doc('start').get()).exists, false)
  })

  test('a missing working roster records one terminal failure and publishes no snapshot', async () => {
    await raid.collection('planning').doc('working').delete()
    assert.equal((await startSweep()).failed, 1)
    await assertFailedRecord('missing-working-roster')
    assert.equal((await guild.collection('raidSnapshotFailures').get()).size, 1)
    assert.equal((await startSweep()).failed, 0)
    assert.equal((await guild.collection('raidSnapshotFailures').get()).size, 1)
  })

  test('irreparable audit history is recorded once as a terminal visible failure', async () => {
    await raid.update({ rev: 1 })
    const first = await startSweep()
    assert.equal(first.failed, 1)
    await assertFailedRecord('invalid-raid-audit-history')
    assert.equal((await guild.collection('raidSnapshotFailures').get()).size, 1)
    assert.equal((await guild.collection('raidSnapshotJobs').doc(raid.id).get()).data().state, 'failed')
    assert.equal((await startSweep()).failed, 0)
    assert.equal((await guild.collection('raidSnapshotFailures').get()).size, 1)
  })

  test('a partially written conflicting capture is never published', async () => {
    const root = raid.collection('snapshots').doc('start')
    await root.set({
      status: 'capturing', scheduledStartAt: start, contentHash: 'incorrect-source',
      capturedAt: Timestamp.fromMillis(start.toMillis() + 500),
    })
    await root.collection('characters').doc('main').set({ id: 'main', name: 'Wrong Snapshot' })
    assert.equal(await captureRaidStartSnapshot(db, guild, raid, raid.id, now), 'failed')
    assert.notEqual((await root.get()).data().status, 'complete')
  })

  // RAID-015: what members can see of a failed capture.
  test('a failure before any record leaves one small failed record, without the server detail, that later runs keep', async () => {
    await raid.collection('planning').doc('working').delete()
    assert.equal((await startSweep()).failed, 1)
    await assertFailedRecord('missing-working-roster')
    const record = raid.collection('snapshots').doc('start')
    const written = (await record.get()).data()
    assert.equal('detail' in written, false)
    const [failure] = (await guild.collection('raidSnapshotFailures').get()).docs
    assert.equal(failure.data().code, 'missing-working-roster')
    assert.match(failure.data().detail, /working roster is missing/)

    // Fixing the cause does not quietly replace it: a retry is a separate, deliberate step (RAID-014).
    await seedRaid()
    assert.equal(await captureRaidStartSnapshot(db, guild, raid, raid.id, now), 'skipped')
    assert.equal((await startSweep(nextRun)).captured, 0)
    assert.deepEqual((await record.get()).data(), written)
    assert.equal((await guild.collection('raidSnapshotFailures').get()).size, 1)
  })

  test('a capture that fails after its manifest exists is marked failed in place, keeping what it wrote', async () => {
    const root = raid.collection('snapshots').doc('start')
    await root.set({ schemaVersion: 1, status: 'capturing', raidId: raid.id, scheduledStartAt: start, contentHash: 'incorrect-source', counts: { lineups: 3, characters: 2, accounts: 1 } })
    await root.collection('characters').doc('main').set({ id: 'main', name: 'Earlier Attempt' })
    assert.equal(await captureRaidStartSnapshot(db, guild, raid, raid.id, now), 'failed')
    const manifest = (await root.get()).data()
    assert.equal(manifest.status, 'failed')
    assert.equal(manifest.failureCode, 'snapshot-source-changed')
    assert.ok(manifest.failedAt instanceof Timestamp)
    assert.equal(manifest.contentHash, 'incorrect-source')
    assert.deepEqual(manifest.counts, { lineups: 3, characters: 2, accounts: 1 })
    assert.equal('failureNotice' in manifest, false)
    assert.equal((await root.collection('characters').doc('main').get()).data().name, 'Earlier Attempt')
  })

  test('a manifest for a different start is left alone and no failed record replaces it', async () => {
    const root = raid.collection('snapshots').doc('start')
    const other = { schemaVersion: 1, status: 'capturing', raidId: raid.id, scheduledStartAt: previousBoundary, contentHash: 'earlier-start' }
    await root.set(other)
    await raid.collection('planning').doc('working').delete()
    assert.equal(await captureRaidStartSnapshot(db, guild, raid, raid.id, now), 'failed')
    assert.deepEqual((await root.get()).data(), other)
  })

  test('a raid that no longer exists gets no failed record', async () => {
    await raid.delete()
    assert.equal(await captureRaidStartSnapshot(db, guild, raid, raid.id, now), 'failed')
    assert.equal((await raid.collection('snapshots').doc('start').get()).exists, false)
    assert.equal((await guild.collection('raidSnapshotFailures').get()).size, 1)
  })

  test('a raid with no scheduled start gets no failed record when its history is broken', async () => {
    await raid.update({ startsAt: FieldValue.delete(), rev: 1 })
    assert.equal(await captureRaidStartSnapshot(db, guild, raid, raid.id, now), 'failed')
    assert.equal((await raid.collection('snapshots').doc('start').get()).exists, false)
    assert.equal((await guild.collection('raidSnapshotFailures').get()).docs[0].data().code, 'invalid-raid-audit-history')
  })
})

// RAID-014's first step: the same sweep, run every five minutes instead of once a day at 9 PM Eastern.
describe('five-minute sweep', () => {
  const checkpointRef = () => db.collection('system').doc('raidStartSnapshotSweep')
  const manifest = async () => (await raid.collection('snapshots').doc('start').get()).data()

  test('a 10 PM raid is captured by the 10:05 PM run, not before and not the next evening', async () => {
    const tenPm = later(start, minutes(60))
    await raid.update({ time: '22:00', startsAt: tenPm })
    await checkpointRef().set({ coveredThrough: later(start, -1) })
    for (let minute = 5; minute <= 60; minute += 5) {
      assert.equal((await startSweep(later(start, minutes(minute)))).captured, 0, `nothing at 9:${String(minute).padStart(2, '0')}`)
    }
    assert.equal(await manifest(), undefined)
    assert.equal((await startSweep(later(tenPm, minutes(5)))).captured, 1)
    assert.equal((await manifest()).scheduledStartAt.toMillis(), tenPm.toMillis())
    assert.equal((await manifest()).raid.time, '22:00')
  })

  test('a raid counts as started two minutes after its start time', async () => {
    await checkpointRef().set({ coveredThrough: later(start, -minutes(10)) })
    const early = await startSweep(later(start, sweepSettleMillis - 1))
    assert.equal(early.captured, 0)
    assert.equal(early.checkpointAdvanced, true)
    assert.equal((await checkpointRef().get()).data().coveredThrough.toMillis(), start.toMillis() - 1)
    assert.equal((await startSweep(later(start, sweepSettleMillis))).captured, 1)
    assert.equal((await checkpointRef().get()).data().coveredThrough.toMillis(), start.toMillis())
  })

  test('a run less than two minutes after the last covered time does nothing and leaves the checkpoint alone', async () => {
    await checkpointRef().set({ coveredThrough: now })
    const result = await startSweep(later(now, minutes(1)))
    assert.deepEqual(result, { captured: 0, failed: 0, retry: 0, skipped: 0, candidates: 0, checkpointAdvanced: false })
    assert.equal((await checkpointRef().get()).data().coveredThrough.toMillis(), now.toMillis())
  })

  test('two runs at once publish one complete snapshot and no failure', async () => {
    const otherRaid = await cloneRaid('raid-two')
    const results = await Promise.all([startSweep(now), startSweep(later(now, minutes(1)))])
    assert.equal(results.reduce((sum, result) => sum + result.failed, 0), 0)
    for (const ref of [raid, otherRaid]) {
      const root = ref.collection('snapshots').doc('start')
      const data = (await root.get()).data()
      assert.equal(data.status, 'complete')
      assert.equal(data.scheduledStartAt.toMillis(), start.toMillis())
      assert.deepEqual((await root.collection('lineups').get()).docs.map((entry) => entry.id).sort(), ['10', '20', '40'])
      assert.deepEqual((await root.collection('characters').get()).docs.map((entry) => entry.id).sort(), ['alt', 'main'])
      assert.deepEqual((await root.collection('accounts').get()).docs.map((entry) => entry.id), ['member-uid'])
    }
    assert.equal((await guild.collection('raidSnapshotFailures').get()).size, 0)
    // The first run to finish moves the checkpoint to its own time; the other sees it moved and leaves it, so it never moves backwards and leaves no gap.
    const covered = (await checkpointRef().get()).data().coveredThrough.toMillis()
    assert.ok([now.toMillis() - sweepSettleMillis, now.toMillis() + minutes(1) - sweepSettleMillis].includes(covered))
    // A run that lost a race on a write may leave its job pending for a moment; the next run finds the snapshot complete and closes the job.
    await startSweep(later(nextRun, minutes(5)))
    assert.deepEqual((await guild.collection('raidSnapshotJobs').get()).docs.map((entry) => entry.data().state), ['complete', 'complete'])
  })

  test('a transient failure is retried 5 minutes later, then 10 minutes after that', async () => {
    const flakyDb = flakyRaidReads(2)
    const job = guild.collection('raidSnapshotJobs').doc(raid.id)
    assert.equal((await runRaidStartSnapshotSweep(flakyDb, now)).retry, 1)
    assert.equal((await job.get()).data().attempts, 1)
    assert.equal((await job.get()).data().nextAttemptAt.toMillis(), later(now, minutes(5) - sweepSettleMillis).toMillis())

    assert.deepEqual(await runRaidStartSnapshotSweep(flakyDb, later(now, minutes(4))), { captured: 0, failed: 0, retry: 0, skipped: 0, candidates: 0, checkpointAdvanced: true })
    assert.equal((await runRaidStartSnapshotSweep(flakyDb, nextRun)).retry, 1)
    assert.equal((await job.get()).data().attempts, 2)
    assert.equal((await job.get()).data().nextAttemptAt.toMillis(), later(nextRun, minutes(10) - sweepSettleMillis).toMillis())

    assert.equal((await runRaidStartSnapshotSweep(flakyDb, later(nextRun, minutes(5)))).retry, 0)
    assert.equal((await runRaidStartSnapshotSweep(flakyDb, later(nextRun, minutes(10)))).captured, 1)
    assert.equal((await job.get()).data().state, 'complete')
    assert.equal((await manifest()).status, 'complete')
  })
})

// A save the app accepted before the start can finish a moment after it; up to a minute later it still counts (loot owner, 2026-11-08).
describe('saves that finish just after the start', () => {
  const signup = () => raid.collection('signups').doc('member-uid')
  const capturedSignup = async () => (await raid.collection('snapshots').doc('start').collection('accounts').doc('member-uid').get()).data()?.signup
  const moveRaidLater = (at) => Promise.all([
    raid.update({ startsAt: later(start, minutes(60)), time: '22:00', rev: 1 }),
    addRaidAudit({ at, changed: ['startsAt', 'time'], before: { startsAt: start, time: '21:00' }, after: { startsAt: later(start, minutes(60)), time: '22:00' } }),
  ])

  test('the capture waits longer than the allowance, so every counted save has landed', () => {
    assert.ok(lateSaveMillis < sweepSettleMillis)
  })

  for (const millis of [1, 30_000, lateSaveMillis]) {
    test(`a sign-up saved ${millis} ms after the start is captured`, async () => {
      await signup().update({ characterId: 'main', status: 'accept', benchKind: FieldValue.delete(), updatedAt: later(start, millis) })
      assert.equal((await startSweep()).captured, 1)
      assert.deepEqual(await capturedSignup(), { characterId: 'main', status: 'accept' })
    })
  }

  test('a sign-up saved more than a minute after the start fails the capture, as before', async () => {
    await signup().update({ status: 'accept', updatedAt: later(start, lateSaveMillis + 1) })
    assert.equal((await startSweep()).failed, 1)
    await assertFailedRecord('signup-changed-after-start')
  })

  test('a working roster saved within a minute of the start is captured', async () => {
    await raid.collection('planning').doc('working').update({ revision: 4, updatedAt: later(start, 45_000) })
    assert.equal((await startSweep()).captured, 1)
    assert.equal((await raid.collection('snapshots').doc('start').get()).data().status, 'complete')
  })

  test('a working roster saved more than a minute after the start fails the capture, as before', async () => {
    await raid.collection('planning').doc('working').update({ revision: 4, updatedAt: later(start, lateSaveMillis + 1) })
    assert.equal((await startSweep()).failed, 1)
    await assertFailedRecord('working-roster-changed-after-start')
  })

  test('once a leader moves a started raid later, a sign-up saved after the move no longer counts for the original start', async () => {
    await moveRaidLater(later(start, 10_000))
    await signup().update({ status: 'accept', updatedAt: later(start, 20_000) })
    assert.equal((await startSweep()).failed, 1)
    await assertFailedRecord('signup-changed-after-start')
  })

  test('a sign-up that finished saving before the leader moved the raid still counts for the original start', async () => {
    await moveRaidLater(later(start, 10_000))
    await signup().update({ characterId: 'main', status: 'accept', benchKind: FieldValue.delete(), updatedAt: later(start, 5_000) })
    assert.equal((await startSweep()).captured, 1)
    assert.deepEqual(await capturedSignup(), { characterId: 'main', status: 'accept' })
    assert.equal((await raid.collection('snapshots').doc('start').get()).data().scheduledStartAt.toMillis(), start.toMillis())
  })
})
