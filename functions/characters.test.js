import assert from 'node:assert/strict'
import { after, beforeEach, describe, test } from 'node:test'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { resolveCharacterRequest, submitCharacterRequest } from './characters.js'
import classes from './characterClasses.json' with { type: 'json' }

const host = process.env.FIRESTORE_EMULATOR_HOST
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Server tests require a local Firestore emulator.')
const app = initializeApp({ projectId: 'demo-intrepid' }, 'character-server-tests')
const db = getFirestore(app)
const guild = db.collection('guilds').doc('test-guild')
const record = (path) => db.doc(`${guild.path}/${path}`)
const request = (data, uid = 'member') => ({ auth: uid ? { uid } : undefined, data: { guildId: guild.id, ...data } })
const submit = (data = {}, uid) => submitCharacterRequest(db, request({
  requestId: 'change', kind: 'rename', characterId: 'main', proposed: { name: 'Starweaver', surname: 'Brightwater' }, note: '', ...data,
}, uid))
const resolve = (action = 'approve', data = {}, uid = 'leader') => resolveCharacterRequest(db, request({ requestId: 'change', action, note: '', ...data }, uid))
const stored = async (path) => (await record(path).get()).data()
const rejected = (operation, code) => assert.rejects(operation, (error) => error.code === code)
const alt = { name: 'Moonfern', surname: '', className: 'Druid', specialization: 'Guardian' }

beforeEach(async () => {
  const cleared = await fetch(`http://${host}/emulator/v1/projects/demo-intrepid/databases/(default)/documents`, { method: 'DELETE' })
  assert.equal(cleared.ok, true)
  const batch = db.batch()
  for (const [uid, role, playerId] of [['member', 'Member', 'main'], ['leader', 'Guild Leader', null], ['raider', 'Raid Leader', null], ['other', 'Member', 'other-main'], ['removed', 'Removed', null]]) {
    batch.set(guild.collection('members').doc(uid), { role, playerId, displayName: `Invented ${uid}` })
  }
  for (const [characterId, fields] of [
    ['main', { linkedUid: 'member' }], ['alt', { mainId: 'main' }], ['alt-two', { mainId: 'main' }],
    ['free', {}], ['other-main', { linkedUid: 'other' }], ['other-alt', { mainId: 'other-main' }],
  ]) batch.set(guild.collection('roster').doc(characterId), { name: `Invented ${characterId}`, className: 'Warrior', specialization: 'Arms', role: 'Tank', ...fields })
  for (const path of ['teamAssignments/main', 'teamAssignments/alt', 'teamAssignments/alt-two']) batch.set(record(path), { team: 'blue' })
  batch.set(record('awards/history'), { recipient: 'Invented main', prioritySnapshot: ['Invented main', 'Invented alt'], councilNoteSnapshot: 'Original decision' })
  batch.set(record('raids/history'), { rosterSnapshot: ['main', 'alt'], zones: [{ id: 'zone', name: 'Original zone', size: 10 }] })
  batch.set(record('raids/history/signups/member'), { characterId: 'main', status: 'accept' })
  batch.set(record('lootPriorities/history'), { rankedPlayers: ['main', 'alt'], councilNote: 'Original priority' })
  await batch.commit()
})
after(() => deleteApp(app))

describe('character request authorization and validation', () => {
  for (const uid of [null, 'outsider', 'removed']) {
    test(`${uid ?? 'anonymous'} cannot submit or resolve requests`, async () => {
      await rejected(submit({}, uid), uid ? 'permission-denied' : 'unauthenticated')
      await rejected(resolve('approve', {}, uid), uid ? 'permission-denied' : 'unauthenticated')
    })
  }
  for (const uid of ['member', 'raider', 'other']) {
    for (const action of ['approve', 'reject']) {
      test(`${uid} cannot ${action}, including their own request`, async () => {
        await submit()
        await rejected(resolve(action, {}, uid), 'permission-denied')
        assert.equal((await stored('characterRequests/change')).status, 'pending')
      })
    }
  }
  test('ownership is derived from the real account, not supplied identity or guild', async () => {
    for (const extra of [{ uid: 'other' }, { userId: 'other' }, { role: 'Guild Leader' }, { status: 'approved' }, { requestedAt: 0 }, { before: {} }, { mainId: 'other-main' }]) {
      await rejected(submit(extra), 'invalid-argument')
    }
    await rejected(submit({ guildId: 'other-guild' }), 'permission-denied')
    for (const characterId of ['other-main', 'other-alt', 'free']) await rejected(submit({ characterId }), 'permission-denied')
  })
  for (const value of ['', '.', '..', 'path/child', 10, null]) {
    test(`invalid request id ${JSON.stringify(value)} is refused`, async () => {
      await rejected(submit({ requestId: value }), 'invalid-argument')
    })
  }
  test('all proposal fields and text limits are enforced', async () => {
    for (const data of [
      { kind: 'unknown' }, { proposed: null }, { proposed: [] }, { proposed: { name: 'New' } },
      { proposed: { name: 'New', surname: '', role: 'Tank' } },
      { proposed: { name: ' ', surname: '' } }, { proposed: { name: 'x'.repeat(31), surname: '' } },
      { proposed: { name: 'New', surname: 'x'.repeat(31) } }, { note: 'x'.repeat(501) }, { note: 3 },
      { kind: 'create-alt', characterId: 'client-chosen-id', proposed: alt },
      { kind: 'create-alt', characterId: null, proposed: { ...alt, role: 'Ranged' } },
      { kind: 'change-spec', proposed: { className: 'Druid', specialization: 'Arms' } },
      { kind: 'change-spec', proposed: { className: '__proto__', specialization: 'Arms' } },
      { kind: 'change-spec', proposed: { className: 'Rogue', specialization: 'Out' + 'law' } },
      { kind: 'promote-main', proposed: { role: 'Healer' } },
    ]) await rejected(submit(data), 'invalid-argument')
  })
  test('no-op spec requests cannot reset a manual role override', async () => {
    await rejected(submit({ kind: 'change-spec', proposed: { className: 'Warrior', specialization: 'Arms' } }), 'failed-precondition')
    assert.equal((await stored('roster/main')).role, 'Tank')
  })
  test('unchanged names and promotion of the current main are refused', async () => {
    await rejected(submit({ proposed: { name: 'Invented main', surname: '' } }), 'failed-precondition')
    await rejected(submit({ kind: 'promote-main', proposed: {} }), 'failed-precondition')
  })
  test('submission snapshots current details and records server identity/time without editing roster', async () => {
    const original = await stored('roster/main')
    await submit({ note: '  Please review.  ' })
    const change = await stored('characterRequests/change')
    assert.equal(change.status, 'pending')
    assert.equal(change.userId, 'member')
    assert.equal(change.displayName, 'Invented member')
    assert.equal(change.note, 'Please review.')
    assert.ok(change.requestedAt instanceof Timestamp)
    assert.deepEqual(change.before, { ...original, surname: '', mainId: null })
    assert.deepEqual(await stored('roster/main'), original)
    await rejected(submit(), 'already-exists')
  })
  for (const fields of [{ playerId: null }, { playerId: 'missing' }, { role: 'Removed' }]) {
    test(`invalid membership ${JSON.stringify(fields)} cannot submit`, async () => {
      await record('members/member').update(fields)
      await assert.rejects(submit())
    })
  }
  for (const fields of [{ mainId: 'other-main' }, { linkedUid: 'other' }]) {
    test(`non-reciprocal main ${JSON.stringify(fields)} cannot submit`, async () => {
      await record('roster/main').update(fields)
      await rejected(submit(), 'failed-precondition')
    })
  }
})

describe('applying approved character changes', () => {
  test('rename retains document identity, extra fields, teams and all history', async () => {
    await record('roster/alt').update({ customField: 'preserve me' })
    const paths = ['teamAssignments/main', 'teamAssignments/alt', 'awards/history', 'raids/history', 'raids/history/signups/member', 'lootPriorities/history', 'members/member']
    const originals = await Promise.all(paths.map(stored))
    await submit({ characterId: 'alt' })
    await resolve('approve', { note: 'Approved by council.' })
    assert.deepEqual(await stored('roster/alt'), { name: 'Starweaver', surname: 'Brightwater', className: 'Warrior', specialization: 'Arms', role: 'Tank', mainId: 'main', customField: 'preserve me' })
    for (const [index, path] of paths.entries()) assert.deepEqual(await stored(path), originals[index])
    const change = await stored('characterRequests/change')
    assert.equal(change.status, 'approved')
    assert.equal(change.resolvedBy, 'leader')
    assert.equal(change.resolutionNote, 'Approved by council.')
    assert.ok(change.resolvedAt instanceof Timestamp)
  })
  for (const [className, specs] of Object.entries(classes)) {
    for (const spec of specs) {
      test(`approval derives ${className} / ${spec.name} role ${spec.role} from shared game data`, async () => {
        if (className === 'Warrior' && spec.name === 'Arms') {
          await record('roster/main').update({ specialization: 'Fury' })
        }
        await submit({ kind: 'change-spec', proposed: { className, specialization: spec.name } })
        await resolve()
        const character = await stored('roster/main')
        assert.equal(character.role, spec.role)
        assert.equal(character.className, className)
        assert.equal(character.specialization, spec.name)
        assert.equal(character.linkedUid, 'member')
      })
    }
  }
  test('new alt receives a server-generated stable id and is created only on approval', async () => {
    await submit({ kind: 'create-alt', characterId: null, proposed: alt })
    const change = await stored('characterRequests/change')
    assert.notEqual(change.characterId, 'change')
    assert.equal(await stored(`roster/${change.characterId}`), undefined)
    await resolve()
    assert.deepEqual(await stored(`roster/${change.characterId}`), { ...alt, role: 'Tank', mainId: 'main' })
  })
  test('linking an existing unlinked character preserves identity and details', async () => {
    const original = await stored('roster/free')
    await submit({ kind: 'link-alt', characterId: 'free', proposed: {} })
    await resolve()
    assert.deepEqual(await stored('roster/free'), { ...original, mainId: 'main' })
  })
  for (const change of [{ linkedUid: 'other' }, { mainId: 'other-main' }]) {
    test(`a claimed target ${JSON.stringify(change)} cannot be linked`, async () => {
      await record('roster/free').update(change)
      await rejected(submit({ kind: 'link-alt', characterId: 'free', proposed: {} }), 'failed-precondition')
    })
  }
  for (const path of ['roster/child', 'members/stale-account']) {
    test(`target with ${path.startsWith('roster') ? 'alts' : 'one-sided account link'} cannot be claimed`, async () => {
      await record(path).set(path.startsWith('roster') ? { mainId: 'free' } : { playerId: 'free', role: 'Member' })
      await rejected(submit({ kind: 'link-alt', characterId: 'free', proposed: {} }), 'failed-precondition')
    })
  }
  test('main swap atomically reparents every direct alt, moves account link and preserves IDs/history/teams', async () => {
    const paths = ['teamAssignments/main', 'teamAssignments/alt', 'teamAssignments/alt-two', 'awards/history', 'raids/history', 'raids/history/signups/member', 'lootPriorities/history']
    const originals = await Promise.all(paths.map(stored))
    await submit({ kind: 'promote-main', characterId: 'alt', proposed: {} })
    // Include alts added after submission: the account family is read again at decision time.
    await record('roster/new-alt').set({ name: 'Starlily', mainId: 'main' })
    await resolve()
    assert.equal((await stored('members/member')).playerId, 'alt')
    assert.equal((await stored('roster/alt')).linkedUid, 'member')
    assert.equal((await stored('roster/alt')).mainId, undefined)
    assert.equal((await stored('roster/main')).linkedUid, undefined)
    for (const characterId of ['main', 'alt-two', 'new-alt']) assert.equal((await stored(`roster/${characterId}`)).mainId, 'alt')
    for (const [index, path] of paths.entries()) assert.deepEqual(await stored(path), originals[index])
    assert.equal((await guild.collection('roster').get()).size, 7)
  })
  test('a separately linked alt prevents a partial main swap', async () => {
    await submit({ kind: 'promote-main', characterId: 'alt', proposed: {} })
    await record('roster/alt-two').update({ linkedUid: 'other' })
    await rejected(resolve(), 'failed-precondition')
    assert.equal((await stored('members/member')).playerId, 'main')
    assert.equal((await stored('characterRequests/change')).status, 'pending')
  })
})

describe('request lifecycle, stale approvals and concurrent decisions', () => {
  test('only the owner may withdraw, and resolution retains immutable request details', async () => {
    await submit()
    const original = await stored('characterRequests/change')
    await rejected(resolve('withdraw', {}, 'leader'), 'permission-denied')
    await rejected(resolve('withdraw', {}, 'other'), 'permission-denied')
    await resolve('withdraw', {}, 'member')
    const saved = await stored('characterRequests/change')
    for (const key of Object.keys(original).filter((key) => key !== 'status')) assert.deepEqual(saved[key], original[key])
    assert.equal(saved.status, 'withdrawn')
    assert.equal((await stored('roster/main')).name, 'Invented main')
    for (const action of ['approve', 'reject', 'withdraw']) await rejected(resolve(action, {}, action === 'withdraw' ? 'member' : 'leader'), 'failed-precondition')
  })
  test('rejection can include an optional note without roster changes; member can submit again', async () => {
    await submit()
    await resolve('reject', { note: 'Please check the spelling.' })
    assert.equal((await stored('characterRequests/change')).resolutionNote, 'Please check the spelling.')
    assert.equal((await stored('roster/main')).name, 'Invented main')
    await submit({ requestId: 'new-request' })
  })
  for (const [path, fields, code] of [
    ['roster/main', { name: 'Leader renamed' }, 'failed-precondition'],
    ['roster/main', { role: 'Ranged' }, 'failed-precondition'],
    ['roster/main', { specialization: 'Fury' }, 'failed-precondition'],
    ['roster/main', { linkedUid: 'other' }, 'failed-precondition'],
    ['members/member', { playerId: 'other-main' }, 'failed-precondition'],
    ['members/member', { role: 'Removed' }, 'permission-denied'],
  ]) {
    test(`approval rechecks changed state ${path} ${JSON.stringify(fields)}`, async () => {
      await submit()
      await record(path).update(fields)
      await rejected(resolve(), code)
      assert.equal((await stored('characterRequests/change')).status, 'pending')
      await resolve('reject')
    })
  }
  test('a deleted character cannot be resurrected by approval', async () => {
    await submit()
    await record('roster/main').delete()
    await rejected(resolve(), 'failed-precondition')
    assert.equal(await stored('roster/main'), undefined)
  })
  test('existing-alt eligibility is checked again at approval', async () => {
    await submit({ kind: 'link-alt', characterId: 'free', proposed: {} })
    await record('roster/new-child').set({ mainId: 'free' })
    await rejected(resolve(), 'failed-precondition')
    assert.equal((await stored('roster/free')).mainId, undefined)
  })
  test('demoting the reviewing leader revokes approval authority', async () => {
    await submit()
    await record('members/leader').update({ role: 'Raid Leader' })
    await rejected(resolve(), 'permission-denied')
  })
  test('concurrent approve/reject produces exactly one terminal decision', async () => {
    await submit()
    const outcomes = await Promise.allSettled([resolve(), resolve('reject')])
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1)
    const change = await stored('characterRequests/change')
    assert.equal((await stored('roster/main')).name, change.status === 'approved' ? 'Starweaver' : 'Invented main')
  })
  test('concurrent conflicting rename approvals cannot overwrite a newer approved name', async () => {
    await submit()
    await submit({ requestId: 'second', proposed: { name: 'Sunfern', surname: '' } })
    const results = await Promise.allSettled([resolve(), resolve('approve', { requestId: 'second' })])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    const records = await guild.collection('characterRequests').get()
    assert.equal(records.docs.filter((record) => record.data().status === 'approved').length, 1)
  })
  test('invalid resolution fields cannot forge an outcome', async () => {
    await submit()
    for (const data of [{ action: 'delete' }, { note: 'x'.repeat(501) }, { resolvedBy: 'other' }, { status: 'approved' }]) {
      await rejected(resolve('approve', data), 'invalid-argument')
    }
  })
})
