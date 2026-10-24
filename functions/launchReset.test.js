import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, afterEach, beforeEach, describe, test } from 'node:test'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { applyLaunchReset, describePlan, isInside, LaunchResetRefused, planLaunchReset, RECORD_ENTRY, SEAL_DOC } from './launchReset.js'

const host = process.env.FIRESTORE_EMULATOR_HOST
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('The launch reset tests require a local Firestore emulator.')

const app = initializeApp({ projectId: 'demo-intrepid' }, 'launch-reset-tests')
const db = getFirestore(app)
let guildId
let guild
let dir

// Invented names. Phase 0 is "Launch prep"; the guild is in phase 1.
const settings = (overrides = {}) => ({ currentPhase: 'Launch', nextPhase: 'Phase two', phaseHistory: ['Launch prep'], phaseRev: 1, ...overrides })
const options = (overrides = {}) => ({ guildId, phase: 0, phaseName: 'Launch prep', backupFile: path.join(dir, 'backup.json'), ...overrides })
const confirmed = { awards: 2, priorities: 2, entries: 6 }

async function seed({ withSettings = true } = {}) {
  const batch = db.batch()
  if (withSettings) batch.set(guild.collection('settings').doc('general'), settings())
  const award = (id, data) => batch.set(guild.collection('awards').doc(id), { item: `Item ${id}`, encounter: 'Test Hall', recipient: 'Aria', awardedAt: '2026-11-05', prioritySnapshot: [], councilNoteSnapshot: '', awardNote: '', ...data })
  award('a0a', { phaseNo: 0, createdAt: Timestamp.fromMillis(1000) })
  award('a0b', {}) // no phase stored: the first phase
  award('a1', { phaseNo: 1 })
  const priority = (id, data) => batch.set(guild.collection('lootPriorities').doc(id), { item: `Item ${id}`, encounter: 'Test Hall', rankedPlayers: ['Aria'], councilNote: '', ...data })
  priority('p0a', { phaseNo: 0 })
  priority('p0b', {})
  priority('p1', { phaseNo: 1 })
  const entry = (id, data) => batch.set(guild.collection('auditLog').doc(id), { at: Timestamp.fromMillis(2000), by: 'uid', byName: 'Invented Leader', rev: 1, action: 'create', item: 'x', changed: [], before: {}, after: {}, ...data })
  entry('award_a0a_1', { targetType: 'award', targetId: 'a0a', after: { phaseNo: 0 } })
  entry('award_a0b_1', { targetType: 'award', targetId: 'a0b', after: {} })
  entry('award_a1_1', { targetType: 'award', targetId: 'a1', after: { phaseNo: 1 } })
  entry('priority_p0a_1', { targetType: 'priority', targetId: 'p0a', after: { phaseNo: 0 } })
  entry('priority_p0b_1', { targetType: 'priority', targetId: 'p0b', after: { item: 'x' } })
  entry('priority_p1_1', { targetType: 'priority', targetId: 'p1', after: { phaseNo: 1 } })
  // A priority of the first phase that was deleted: no document, its create entry lists no phase and its delete entry lists the one it had.
  entry('priority_gone_1', { targetType: 'priority', targetId: 'gone', after: { item: 'x' } })
  entry('priority_gone_2', { targetType: 'priority', targetId: 'gone', rev: 2, action: 'delete', before: { phaseNo: 0 } })
  // An entry about a priority that is gone and whose phase nothing says: kept, and reported.
  entry('priority_mystery_2', { targetType: 'priority', targetId: 'mystery', rev: 2, action: 'edit', changed: ['councilNote'] })
  entry('phase_settings_1', { targetType: 'phase', targetId: 'settings', action: 'start' })
  entry('table_z1_0', { targetType: 'table', targetId: 'z50000001_0' })
  entry('raid_r1_1', { targetType: 'raid', targetId: 'r1', action: 'edit' })
  batch.set(guild.collection('lootTables').doc('z50000001_0'), { type: 'zone', zoneId: 50000001, phaseNo: 0, name: 'Invented Keep' })
  await batch.commit()
}

const ids = async (name) => (await guild.collection(name).get()).docs.map((doc) => doc.id).sort()
const exists = async (file) => { try { await stat(file); return true } catch { return false } }

beforeEach(async () => {
  guildId = `reset-${randomUUID()}`
  guild = db.collection('guilds').doc(guildId)
  dir = await mkdtemp(path.join(os.tmpdir(), 'launch-reset-'))
})
afterEach(async () => {
  await db.recursiveDelete(guild)
  await rm(dir, { recursive: true, force: true })
})
after(() => deleteApp(app))

describe('the plan', () => {
  test('counts what would be erased and what is kept, and erases nothing', async () => {
    await seed()
    const plan = await planLaunchReset(db, options())
    assert.deepEqual(plan.counts, confirmed)
    assert.deepEqual(plan.kept, { awards: 1, priorities: 1, entries: 6, unresolvedTargets: ['priority:mystery'] })
    assert.deepEqual(plan.awards.map((doc) => doc.id).sort(), ['a0a', 'a0b'])
    assert.deepEqual(plan.entries.map((doc) => doc.id).sort(), ['award_a0a_1', 'award_a0b_1', 'priority_gone_1', 'priority_gone_2', 'priority_p0a_1', 'priority_p0b_1'])
    assert.equal((await ids('awards')).length, 3)
    assert.equal((await ids('auditLog')).length, 12)
    assert.match(describePlan(plan), /Would erase  2 awards, 2 loot priorities and 6 Log entries/)
  })

  test('an award or priority keeps its own phase, whatever its old entries say', async () => {
    await seed()
    // Created in the first phase, corrected into the second: the award is the second phase's and so are all its entries.
    await guild.collection('awards').doc('a0a').update({ phaseNo: 1 })
    const plan = await planLaunchReset(db, options())
    assert.equal(plan.counts.awards, 1)
    assert.ok(!plan.entries.some((doc) => doc.id === 'award_a0a_1'))
  })

  test('refuses until the phase has finished, so the first real phase has to have started', async () => {
    await seed({ withSettings: false })
    await guild.collection('settings').doc('general').set(settings({ phaseHistory: [] }))
    await assert.rejects(planLaunchReset(db, options()), (error) => error instanceof LaunchResetRefused && /has not finished/.test(error.message))
  })

  test('refuses when the phase is not the one named', async () => {
    await seed()
    await assert.rejects(planLaunchReset(db, options({ phaseName: 'Launch' })), (error) => error instanceof LaunchResetRefused && /is called "Launch prep"/.test(error.message))
  })

  test('refuses a guild that has no settings, and a phase that is not a number', async () => {
    await assert.rejects(planLaunchReset(db, options()), (error) => error instanceof LaunchResetRefused && /no settings/.test(error.message))
    await seed()
    await assert.rejects(planLaunchReset(db, options({ phase: -1 })), LaunchResetRefused)
    await assert.rejects(planLaunchReset(db, options({ phase: 'zero' })), LaunchResetRefused)
    await assert.rejects(planLaunchReset(db, options({ phaseName: '  ' })), LaunchResetRefused)
  })
})

describe('applying the reset', () => {
  test('erases exactly the phase, keeps everything else, backs it up first, records it and seals the guild', async () => {
    await seed()
    const erased = await applyLaunchReset(db, options(), confirmed, { now: () => new Date('2026-12-09T22:00:00Z') })
    assert.deepEqual(erased, { awards: 2, priorities: 2, auditEntries: 6 })
    assert.deepEqual(await ids('awards'), ['a1'])
    assert.deepEqual(await ids('lootPriorities'), ['p1'])
    assert.deepEqual(await ids('lootTables'), ['z50000001_0'])
    assert.deepEqual(await ids('auditLog'), ['award_a1_1', RECORD_ENTRY, 'phase_settings_1', 'priority_mystery_2', 'priority_p1_1', 'raid_r1_1', 'table_z1_0'].sort())
    assert.equal((await guild.collection('settings').doc('general').get()).data().currentPhase, 'Launch')

    const seal = (await guild.collection('settings').doc(SEAL_DOC).get()).data()
    assert.deepEqual({ ...seal, erasedAt: undefined }, { phaseNo: 0, phaseName: 'Launch prep', erasedAt: undefined, erased, backupFile: 'backup.json', version: 1 })
    assert.equal(seal.erasedAt.toDate().toISOString(), '2026-12-09T22:00:00.000Z')
    const record = (await guild.collection('auditLog').doc(RECORD_ENTRY).get()).data()
    assert.equal(record.targetType, 'ledger')
    assert.equal(record.action, 'erase')
    assert.deepEqual(record.before, { phaseNo: 0, awards: 2, priorities: 2, auditEntries: 6 })

    const backup = JSON.parse(await readFile(path.join(dir, 'backup.json'), 'utf8'))
    assert.deepEqual([backup.awards.length, backup.priorities.length, backup.entries.length], [2, 2, 6])
    assert.deepEqual(backup.awards.map((award) => award.id).sort(), ['a0a', 'a0b'])
    assert.deepEqual(backup.awards.find((award) => award.id === 'a0a').data.createdAt, { __timestamp: '1970-01-01T00:00:01.000Z' })
  })

  test('can only be done once', async () => {
    await seed()
    await applyLaunchReset(db, options(), confirmed)
    await assert.rejects(applyLaunchReset(db, options({ backupFile: path.join(dir, 'second.json') }), { awards: 0, priorities: 0, entries: 0 }), (error) => error instanceof LaunchResetRefused && /already had its launch reset/.test(error.message))
    await assert.rejects(planLaunchReset(db, options()), LaunchResetRefused)
  })

  test('erases nothing unless the counts confirmed are exactly the counts now', async () => {
    await seed()
    for (const wrong of [{ ...confirmed, awards: 1 }, { ...confirmed, priorities: 3 }, { ...confirmed, entries: 5 }, { awards: 2, priorities: 2 }, undefined]) {
      await assert.rejects(applyLaunchReset(db, options(), wrong), LaunchResetRefused)
    }
    assert.equal((await ids('awards')).length, 3)
    assert.equal(await exists(path.join(dir, 'backup.json')), false)
    assert.equal((await guild.collection('settings').doc(SEAL_DOC).get()).exists, false)
  })

  test('refuses loot recorded in the phase after the dry run, instead of erasing it unseen', async () => {
    await seed()
    await guild.collection('awards').doc('late').set({ item: 'Late', recipient: 'Aria', awardedAt: '2026-12-09', phaseNo: 0 })
    await assert.rejects(applyLaunchReset(db, options(), confirmed), (error) => error instanceof LaunchResetRefused && /awards: 2 were confirmed but 3 would be erased/.test(error.message))
    assert.equal((await ids('awards')).length, 4)
  })

  test('never overwrites a backup, and wants an absolute path', async () => {
    await seed()
    await applyLaunchReset(db, options(), confirmed)
    await seed()
    await guild.collection('settings').doc(SEAL_DOC).delete()
    await assert.rejects(applyLaunchReset(db, options(), confirmed), (error) => error instanceof LaunchResetRefused && /already exists and is never overwritten/.test(error.message))
    assert.equal((await ids('awards')).length, 3)
    await assert.rejects(applyLaunchReset(db, options({ backupFile: 'backup.json' }), confirmed), LaunchResetRefused)
  })

  test('refuses when there is nothing to erase, and does not seal the guild', async () => {
    await seed()
    await applyLaunchReset(db, options(), confirmed)
    await guild.collection('settings').doc(SEAL_DOC).delete()
    await assert.rejects(applyLaunchReset(db, options({ backupFile: path.join(dir, 'again.json') }), { awards: 0, priorities: 0, entries: 0 }), (error) => error instanceof LaunchResetRefused && /nothing of that phase to erase/.test(error.message))
    assert.equal((await guild.collection('settings').doc(SEAL_DOC).get()).exists, false)
  })

  test('does not seal the guild when something of the phase is still there afterwards, and can be run again', async () => {
    await seed()
    // A delete that stops half way: the first batch of the list is erased and then the run fails.
    const failing = async (database, refs) => { await refs[0].delete(); throw new Error('The connection dropped.') }
    await assert.rejects(applyLaunchReset(db, options(), confirmed, { erase: failing }), /connection dropped/)
    assert.equal((await guild.collection('settings').doc(SEAL_DOC).get()).exists, false)
    assert.equal(await exists(path.join(dir, 'backup.json')), true)
    // The dry run now shows what is left, and the second run, confirmed and with a new backup file, finishes and seals.
    const left = await planLaunchReset(db, options())
    assert.equal(left.counts.awards + left.counts.priorities + left.counts.entries, 9)
    await applyLaunchReset(db, options({ backupFile: path.join(dir, 'second.json') }), left.counts)
    assert.deepEqual(await ids('awards'), ['a1'])
    assert.equal((await guild.collection('settings').doc(SEAL_DOC).get()).exists, true)
  })

  test('does not seal the guild when the erase left something behind', async () => {
    await seed()
    const forgetful = async (database, refs) => { await Promise.all(refs.slice(1).map((ref) => ref.delete())) }
    await assert.rejects(applyLaunchReset(db, options(), confirmed, { erase: forgetful }), (error) => error instanceof LaunchResetRefused && /still there/.test(error.message))
    assert.equal((await guild.collection('settings').doc(SEAL_DOC).get()).exists, false)
    assert.equal((await guild.collection('auditLog').doc(RECORD_ENTRY).get()).exists, false)
  })

  test('erases a phase after the first one only when that phase is named and has finished', async () => {
    await seed()
    await guild.collection('settings').doc('general').set(settings({ currentPhase: 'Third', phaseHistory: ['Launch prep', 'Launch'], phaseRev: 2 }))
    await assert.rejects(planLaunchReset(db, options({ phase: 1, phaseName: 'Launch prep' })), LaunchResetRefused)
    const plan = await planLaunchReset(db, options({ phase: 1, phaseName: 'Launch' }))
    assert.deepEqual(plan.awards.map((doc) => doc.id), ['a1'])
    assert.deepEqual(plan.counts, { awards: 1, priorities: 1, entries: 2 })
  })
})

describe('isInside', () => {
  test('says whether a file is inside a directory', () => {
    assert.equal(isInside('/work/repo/backup.json', '/work/repo'), true)
    assert.equal(isInside('/work/repo/sub/dir/backup.json', '/work/repo'), true)
    assert.equal(isInside('/work/repo-backups/backup.json', '/work/repo'), false)
    assert.equal(isInside('/work/backup.json', '/work/repo'), false)
    assert.equal(isInside('/work/repo/../backup.json', '/work/repo'), false)
  })
})
