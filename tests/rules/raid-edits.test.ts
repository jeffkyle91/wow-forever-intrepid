// Editing, cancelling and restoring a raid (match /raids/{raidId}: update). Every change is one batch: the
// raid update plus its audit entry (auditLog/raid_{id}_{rev}), like an award edit. A cancelled raid stays on
// the calendar with status 'cancelled' and a reason. Guild Leaders and Raid Leaders may do it; nobody else.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteField, FieldValue, serverTimestamp, setDoc, Timestamp, writeBatch, type DocumentData } from 'firebase/firestore'
import { UID, displayNameOf, raidDoc } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildDoc, stored, setUpGuildEmulator } from './support/harness.ts'

setUpGuildEmulator()

const RAID = 'raid-1' // seeded by the fixtures without rev or status, like every raid scheduled before this change
type Who = 'raidLeader' | 'guildLeader' | 'member'

const clean = (data: DocumentData): DocumentData => Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))

type Change = {
  who?: Who
  changes?: DocumentData // what the raid update sets
  stamp?: DocumentData // overrides for rev, updatedBy, updatedAt
  action?: string
  entry?: DocumentData // overrides for the audit entry
  entryRev?: number // the rev in the entry id and entry body
  skipEntry?: boolean
  skipRaid?: boolean
  raid?: string
}

/** One batch: the raid update plus an honest entry for it. Either part can be altered or left out. */
async function changeRaid({ who = 'raidLeader', changes = { name: 'Renamed Raid' }, stamp = {}, action = 'edit', entry = {}, entryRev, skipEntry = false, skipRaid = false, raid = RAID }: Change = {}) {
  const db = dbFor(who)
  const current = await stored(`raids/${raid}`)
  const rev = (current?.rev ?? 0) + 1
  const logged = entryRev ?? rev
  const keys = Object.keys(changes)
  const after = Object.fromEntries(keys.map((key) => [key, changes[key] instanceof FieldValue ? null : changes[key]]))
  const batch = writeBatch(db)
  if (!skipRaid) batch.update(guildDoc(db, `raids/${raid}`), clean({ ...changes, rev, updatedBy: UID[who], updatedAt: serverTimestamp(), ...stamp }))
  if (!skipEntry) {
    batch.set(guildDoc(db, `auditLog/raid_${raid}_${logged}`), clean({
      at: serverTimestamp(), by: UID[who], byName: displayNameOf(UID[who]), targetType: 'raid', targetId: raid, rev: logged, action, item: current?.name,
      changed: keys, before: Object.fromEntries(keys.map((key) => [key, current?.[key] ?? null])), after,
      ...(action === 'cancel' ? { reason: changes.cancelReason } : {}),
      ...entry,
    }))
  }
  return batch.commit()
}

const cancelled = (overrides: DocumentData = {}) => raidDoc(UID.raidLeader, { rev: 1, status: 'cancelled', cancelReason: 'Tank unavailable', updatedBy: UID.raidLeader, updatedAt: new Date('2026-12-01T00:00:00Z'), ...overrides })
const seed = (data: DocumentData) => asAdmin((db) => setDoc(guildDoc(db, `raids/${RAID}`), data))

describe('editing a raid', () => {
  for (const who of ['raidLeader', 'guildLeader'] as const) {
    test(`a ${who} can correct the name, date and size, and the entry records it`, async () => {
      await expectAllowed(changeRaid({ who, changes: { name: 'Fixed Name', date: '2026-12-11', size: 40 } }))
      const raid = await stored(`raids/${RAID}`)
      assert.equal(raid?.name, 'Fixed Name')
      assert.equal(raid?.date, '2026-12-11')
      assert.equal(raid?.size, 40)
      assert.equal(raid?.rev, 1)
      assert.equal(raid?.createdBy, UID.raidLeader)
      const entry = await stored(`auditLog/raid_${RAID}_1`)
      assert.equal(entry?.item, 'Test Raid')
      assert.deepEqual(entry?.changed, ['name', 'date', 'size'])
    })
  }

  test('a second edit uses the next revision', async () => {
    await expectAllowed(changeRaid())
    await expectAllowed(changeRaid({ changes: { size: 10 } }))
    assert.equal((await stored(`raids/${RAID}`))?.rev, 2)
    assert.equal((await stored(`auditLog/raid_${RAID}_2`))?.item, 'Renamed Raid')
  })

  test('a zone selection is saved with its exact audit snapshot', async () => {
    const zones = [{ id: 'barrow-deeps', name: 'Barrow Deeps', size: 10 }, { id: 'hyjal-summit', name: 'Hyjal Summit', size: 20 }]
    await expectAllowed(changeRaid({ changes: { zones } }))
    assert.deepEqual((await stored(`raids/${RAID}`))?.zones, zones)
    assert.deepEqual((await stored(`auditLog/raid_${RAID}_1`))?.after, { zones })
  })

  test('a legacy raid gets an audited start instant', async () => {
    const startsAt = Timestamp.fromDate(new Date('2026-12-10T02:00:00Z'))
    await expectAllowed(changeRaid({ changes: { startsAt } }))
    assert.ok((await stored(`raids/${RAID}`))?.startsAt.isEqual(startsAt))
    assert.deepEqual((await stored(`auditLog/raid_${RAID}_1`))?.before, { startsAt: null })
    assert.ok((await stored(`auditLog/raid_${RAID}_1`))?.after.startsAt.isEqual(startsAt))
  })

  test('unchanged zones must not be reported as changed when initializing a raid', async () => {
    const zones = [{ id: 'test-summit', name: 'Test Summit', size: 20 }, { id: 'test-lair', name: 'Test Lair', size: 40 }]
    await seed(raidDoc(UID.raidLeader, { size: 40, zones }))
    const startsAt = Timestamp.fromDate(new Date('2026-12-10T02:00:00Z'))
    await expectDenied(changeRaid({ changes: { zones: zones.map(({ id, name, size }) => ({ size, name, id })), startsAt } }))
    await expectAllowed(changeRaid({ changes: { startsAt } }))
    assert.deepEqual((await stored(`auditLog/raid_${RAID}_1`))?.changed, ['startsAt'])
  })

  for (const count of [2]) {
    test(`initializing a legacy raid with ${count} selected zones preserves its snapshots`, async () => {
      const zones = Array.from({ length: count }, (_, index) => ({ id: `zone-${index}`, name: `Test Zone ${index}`, size: index % 2 ? 40 : 20 }))
      await seed(raidDoc(UID.raidLeader, { size: 40, zones }))
      const startsAt = Timestamp.fromDate(new Date('2026-12-10T02:00:00Z'))
      await expectAllowed(changeRaid({ changes: { startsAt } }))
      assert.deepEqual((await stored(`raids/${RAID}`))?.zones, zones)
    })
    test(`saving a legacy raid with ${count} reordered zone snapshots and a start instant succeeds`, async () => {
      const zones = Array.from({ length: count }, (_, index) => ({ id: `zone-${index}`, name: `Test Zone ${index}`, size: index % 2 ? 40 : 20 }))
      await seed(raidDoc(UID.raidLeader, { size: 40, zones }))
      const startsAt = Timestamp.fromDate(new Date('2026-12-10T02:00:00Z'))
      await expectAllowed(changeRaid({ changes: { zones: [...zones].reverse(), startsAt } }))
    })
  }

  test('rescheduling preserves the server cutoff and its audit truth', async () => {
    const startsAt = Timestamp.fromDate(new Date('2026-12-10T02:00:00Z'))
    await seed(raidDoc(UID.raidLeader, { startsAt }))
    await expectDenied(changeRaid({ changes: { date: '2026-12-11' } }))
    await expectDenied(changeRaid({ changes: { startsAt: deleteField() } }))
    await expectDenied(changeRaid({ changes: { startsAt: 'not-a-timestamp' } }))
    const next = Timestamp.fromDate(new Date('2026-12-12T02:00:00Z'))
    await expectDenied(changeRaid({ changes: { date: '2026-12-11', startsAt: next }, entry: { after: { date: '2026-12-11', startsAt } } }))
    await expectAllowed(changeRaid({ changes: { date: '2026-12-11', startsAt: next } }))
  })

  test('a member cannot edit a raid, even with an honest entry', async () => {
    await expectDenied(changeRaid({ who: 'member' }))
    assert.equal((await stored(`raids/${RAID}`))?.name, 'Test Raid')
  })

  const refused: [string, Change][] = [
    ['an edit without its audit entry', { skipEntry: true }],
    ['an audit entry without the edit', { skipRaid: true }],
    ['a revision that skips ahead', { stamp: { rev: 5 }, entryRev: 5 }],
    ['an entry for a different revision than the raid carries', { entryRev: 2 }],
    ['an updatedBy that is someone else', { stamp: { updatedBy: UID.guildLeader } }],
    ['an updatedAt chosen by the client', { stamp: { updatedAt: new Date('2020-01-01T00:00:00Z') } }],
    ['a createdBy changed', { changes: { name: 'Renamed Raid', createdBy: UID.guildLeader } }],
    ['an empty name', { changes: { name: '' } }],
    ['a name of 81 characters', { changes: { name: 'x'.repeat(81) } }],
    ['a size of 25', { changes: { size: 25 } }],
    ['a malformed zone snapshot', { changes: { zones: [{ id: 'barrow-deeps', name: 'Barrow Deeps', size: 25 }] } }],
    ['a date in the wrong format', { changes: { date: '09/12/2026' } }],
    ['an extra field', { changes: { name: 'Renamed Raid', notes: 'bring flasks' } }],
    ['an entry that lists a field that did not change', { entry: { changed: ['name', 'size'], before: { name: 'Test Raid', size: 20 }, after: { name: 'Renamed Raid', size: 20 } } }],
    ['an entry with a wrong before value', { entry: { before: { name: 'Something Else' } } }],
    ['an entry with a wrong after value', { entry: { after: { name: 'Something Else' } } }],
    ['an entry that is not for this raid', { entry: { targetId: 'raid-2' } }],
    ['an entry written under another name', { entry: { byName: 'Somebody Else' } }],
    ['an entry with an item that is not the raid name', { entry: { item: 'Another Raid' } }],
    ['an entry for a different action', { action: 'cancel' }],
  ]
  for (const [what, change] of refused) {
    test(`${what} is refused`, async () => {
      await expectDenied(changeRaid(change))
      assert.equal((await stored(`raids/${RAID}`))?.name, 'Test Raid')
      assert.equal(await stored(`auditLog/raid_${RAID}_1`), undefined)
    })
  }

  test('a raid cannot be deleted, even with an entry', async () => {
    const db = dbFor('guildLeader')
    const batch = writeBatch(db)
    batch.delete(guildDoc(db, `raids/${RAID}`))
    await expectDenied(batch.commit())
    assert.ok(await stored(`raids/${RAID}`))
  })
})

describe('a raid description', () => {
  test('can be added, changed and cleared, each with an entry', async () => {
    await expectAllowed(changeRaid({ changes: { description: 'Bring flasks.' } }))
    assert.equal((await stored(`raids/${RAID}`))?.description, 'Bring flasks.')
    await expectAllowed(changeRaid({ changes: { description: 'x'.repeat(500) } }))
    await expectAllowed(changeRaid({ changes: { description: deleteField() } }))
    const raid = await stored(`raids/${RAID}`)
    assert.equal(raid?.description, undefined)
    assert.equal(raid?.rev, 3)
    assert.deepEqual((await stored(`auditLog/raid_${RAID}_3`))?.changed, ['description'])
  })

  test('is kept when the raid is cancelled', async () => {
    await seed(raidDoc(UID.raidLeader, { rev: 1, description: 'Bring flasks.', updatedBy: UID.raidLeader, updatedAt: new Date('2026-12-01T00:00:00Z') }))
    await expectAllowed(changeRaid({ action: 'cancel', changes: { status: 'cancelled', cancelReason: 'Tank unavailable' } }))
    assert.equal((await stored(`raids/${RAID}`))?.description, 'Bring flasks.')
  })

  const refused: [string, Change][] = [
    ['a description of 501 characters', { changes: { description: 'x'.repeat(501) } }],
    ['an empty description', { changes: { description: '' } }],
    ['a description that is a number', { changes: { description: 7 } }],
    ['a description change by a member', { who: 'member', changes: { description: 'Hi' } }],
    ['a description change the entry does not list', { changes: { description: 'Hi' }, entry: { changed: ['name'], before: { name: 'Test Raid' }, after: { name: 'Renamed Raid' } } }],
    ['a description change with a wrong after value', { changes: { description: 'Hi' }, entry: { after: { description: 'Other' } } }],
  ]
  for (const [what, change] of refused) {
    test(`${what} is refused`, async () => {
      await expectDenied(changeRaid(change))
      assert.equal((await stored(`raids/${RAID}`))?.description, undefined)
    })
  }
})

describe('a raid start time', () => {
  test('can be set and changed, each with an entry', async () => {
    await expectAllowed(changeRaid({ changes: { time: '19:30' } }))
    assert.equal((await stored(`raids/${RAID}`))?.time, '19:30')
    await expectAllowed(changeRaid({ changes: { time: '00:00' } }))
    await expectAllowed(changeRaid({ changes: { time: '23:59' } }))
    assert.deepEqual((await stored(`auditLog/raid_${RAID}_3`))?.changed, ['time'])
  })

  for (const bad of ['9:00', '24:00', '21:60', '21:00:00', '', 2100, '9pm']) {
    test(`${JSON.stringify(bad)} is refused`, async () => {
      await expectDenied(changeRaid({ changes: { time: bad } }))
      assert.equal((await stored(`raids/${RAID}`))?.time, undefined)
    })
  }

  test('a time change by a member is refused', async () => {
    await expectDenied(changeRaid({ who: 'member', changes: { time: '20:00' } }))
  })

  test('a time change the entry does not list is refused', async () => {
    await expectDenied(changeRaid({ changes: { time: '20:00' }, entry: { changed: ['name'], before: { name: 'Test Raid' }, after: { name: 'Renamed Raid' } } }))
  })
})

describe('cancelling a raid', () => {
  const cancel = (overrides: Change = {}) => changeRaid({ action: 'cancel', changes: { status: 'cancelled', cancelReason: 'Tank unavailable' }, ...overrides })

  for (const who of ['raidLeader', 'guildLeader'] as const) {
    test(`a ${who} can cancel a raid with a reason and it stays in the list`, async () => {
      await expectAllowed(cancel({ who }))
      const raid = await stored(`raids/${RAID}`)
      assert.equal(raid?.status, 'cancelled')
      assert.equal(raid?.cancelReason, 'Tank unavailable')
      assert.equal(raid?.name, 'Test Raid')
      const entry = await stored(`auditLog/raid_${RAID}_1`)
      assert.equal(entry?.action, 'cancel')
      assert.equal(entry?.reason, 'Tank unavailable')
    })
  }

  test('a member cannot cancel a raid', async () => {
    await expectDenied(cancel({ who: 'member' }))
  })

  const refused: [string, Change][] = [
    ['no reason', { changes: { status: 'cancelled' }, entry: { reason: 'Tank unavailable' } }],
    ['a blank reason', { changes: { status: 'cancelled', cancelReason: '   ' }, entry: { reason: '   ' } }],
    ['a reason of 301 characters', { changes: { status: 'cancelled', cancelReason: 'x'.repeat(301) }, entry: { reason: 'x'.repeat(301) } }],
    ['a reason that is not a string', { changes: { status: 'cancelled', cancelReason: 7 }, entry: { reason: '7' } }],
    ['an entry with a different reason than the raid carries', { entry: { reason: 'Something else' } }],
    ['an entry with no reason', { entry: { reason: undefined } }],
    ['a cancellation logged as an edit', { action: 'edit' }],
    ['a status that is not scheduled or cancelled', { changes: { status: 'removed', cancelReason: 'Tank unavailable' } }],
  ]
  for (const [what, change] of refused) {
    test(`a cancellation with ${what} is refused`, async () => {
      await expectDenied(cancel(change))
      assert.equal((await stored(`raids/${RAID}`))?.status, undefined)
    })
  }

  test('a raid cannot be cancelled twice', async () => {
    await expectAllowed(cancel())
    await expectDenied(cancel({ changes: { status: 'cancelled', cancelReason: 'Different reason' } }))
  })

  test('a cancelled raid can still be corrected, and stays cancelled', async () => {
    await seed(cancelled())
    await expectAllowed(changeRaid({ changes: { date: '2026-12-16' } }))
    const raid = await stored(`raids/${RAID}`)
    assert.equal(raid?.status, 'cancelled')
    assert.equal(raid?.date, '2026-12-16')
    assert.equal(raid?.rev, 2)
  })

  test('an edit cannot drop the reason while the raid is cancelled', async () => {
    await seed(cancelled())
    await expectDenied(changeRaid({ changes: { cancelReason: deleteField() } }))
  })
})

describe('restoring a cancelled raid', () => {
  test('a leader can put it back to scheduled, which clears the reason', async () => {
    await seed(cancelled())
    await expectAllowed(changeRaid({ changes: { status: 'scheduled', cancelReason: deleteField() } }))
    const raid = await stored(`raids/${RAID}`)
    assert.equal(raid?.status, 'scheduled')
    assert.equal(raid?.cancelReason, undefined)
    const entry = await stored(`auditLog/raid_${RAID}_2`)
    assert.equal(entry?.action, 'edit')
    assert.deepEqual(entry?.before, { status: 'cancelled', cancelReason: 'Tank unavailable' })
  })

  test('restoring while keeping the old reason is refused', async () => {
    await seed(cancelled())
    await expectDenied(changeRaid({ changes: { status: 'scheduled' } }))
  })

  test('a member cannot restore a raid', async () => {
    await seed(cancelled())
    await expectDenied(changeRaid({ who: 'member', changes: { status: 'scheduled', cancelReason: deleteField() } }))
  })
})
