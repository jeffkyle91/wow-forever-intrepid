// Audit log: the auditLog block of firestore.rules, and the edit rule for awards that depends on it
// (match /awards/{awardId} update, validAwardEdit, validAuditEntry and auditDescribesChange).
//
// A Guild or Raid Leader can correct an award after the fact, but only in a batch that also writes an audit
// entry for that exact change. The entry rule in turn only accepts an entry that matches a real change in the
// same batch and describes it truthfully: which fields changed, their old and new values, whether it was a
// removal. Entries can never be edited or deleted, by anyone. The snapshot an award was decided with, and who
// created it and when, never change. See docs/design/audit-first-loot.md.
//
// Everything loot writes now needs its entry: an award edit, a new award (awards.test.ts, manual-awards.test.ts) and every priority
// create, edit and delete (priority-audit.test.ts). The entry rules are tested here and in audit-details.test.ts.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deleteDoc, deleteField, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch, type DocumentData } from 'firebase/firestore'
import {
  ANY_ROLE, LABEL, PERSONAS, PLAYER_1, PLAYER_2, PLAYER_3, PRIORITY_ID, RAID_STAFF, UID, awardDoc, displayNameOf, priorityDoc, uidOf,
} from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildCollection, guildDoc, stored, setUpGuildEmulator } from './support/harness.ts'
import { AWARD, clean, createPriority, deletePriority, describeChange, editAward, editPriority, entry, entryId, newPriorityDoc, reorderPriority, stamp, stampedAward, type Staff } from './support/audit.ts'
import { asDouble, rawCommit, requestTime } from './support/raw.ts'

setUpGuildEmulator()

for (const who of RAID_STAFF as readonly Staff[]) {
  // match /awards/{awardId}: update, with the entry written in the same batch
  describe(`a ${LABEL[who]} corrects an award`, () => {
    test('an edit with its audit entry is accepted, and the award and the entry both carry the revision', async () => {
      await expectAllowed(editAward(dbFor(who), who))
      const award = await stored(`awards/${AWARD}`)
      assert.equal(award?.recipient, PLAYER_3)
      assert.equal(award?.rev, 1)
      assert.equal(award?.updatedBy, UID[who])
      const logged = await stored(`auditLog/${entryId('award', AWARD, 1)}`)
      assert.equal(logged?.by, UID[who])
      assert.deepEqual(logged?.changed, ['recipient'])
      assert.deepEqual(logged?.before, { recipient: PLAYER_2 })
      assert.deepEqual(logged?.after, { recipient: PLAYER_3 })
    })

    test('each further edit needs its own entry at the next revision, and a revision is used only once', async () => {
      const db = dbFor(who)
      await expectAllowed(editAward(db, who, { rev: 1 }))
      await expectAllowed(editAward(db, who, { rev: 2, changes: { recipient: PLAYER_1 } }))
      assert.equal((await stored(`awards/${AWARD}`))?.rev, 2)
      await expectDenied(editAward(db, who, { rev: 3, changes: { recipient: PLAYER_2 }, skipEntry: true }), 'a third edit with no entry of its own')
      await expectDenied(editAward(db, who, { rev: 2, changes: { recipient: PLAYER_2 } }), 'repeating revision 2')
      await expectDenied(editAward(db, who, { rev: 1, changes: { recipient: PLAYER_2 } }), 'going back to revision 1')
      assert.equal((await stored(`awards/${AWARD}`))?.recipient, PLAYER_1)
    })

    test('an edit without an audit entry is refused', async () => {
      await expectDenied(editAward(dbFor(who), who, { skipEntry: true }))
      assert.equal((await stored(`awards/${AWARD}`))?.recipient, PLAYER_2)
    })

    test('an audit entry without the edit it describes is refused', async () => {
      await expectDenied(editAward(dbFor(who), who, { skipAward: true }))
      assert.equal(await stored(`auditLog/${entryId('award', AWARD, 1)}`), undefined)
    })

    test('an edit that skips a revision or does not raise it is refused', async () => {
      for (const rev of [0, 2, 5, -1]) await expectDenied(editAward(dbFor(who), who, { rev }), `revision ${rev}`)
      assert.equal((await stored(`awards/${AWARD}`))?.rev, undefined)
    })

    test('two edits of the same revision cannot both land', async () => {
      await expectAllowed(editAward(dbFor(who), who, { rev: 1 }))
      await expectDenied(editAward(dbFor('guildLeader'), 'guildLeader', { rev: 1, changes: { recipient: PLAYER_1 } }))
    })

    test('one entry cannot be shared by two edits or stand next to a second entry', async () => {
      const db = dbFor(who)
      const batch = writeBatch(db)
      batch.update(guildDoc(db, `awards/${AWARD}`), { recipient: PLAYER_3, ...stamp(who, 1) })
      batch.set(guildDoc(db, `auditLog/${entryId('award', AWARD, 1)}`), entry(who, 'award', AWARD, 1, { item: 'Test Sword', ...describeChange(awardDoc(), { recipient: PLAYER_3 }) }))
      batch.set(guildDoc(db, 'auditLog/duplicate-entry'), entry(who, 'award', AWARD, 1, { reason: 'a second, different story', ...describeChange(awardDoc(), { recipient: PLAYER_3 }) }))
      await expectDenied(batch.commit())
    })

    // The entry id is {type}_{targetId}_{rev}; the entry has to name the same target, type and revision.
    const brokenEntries: [string, DocumentData][] = [
      ['written for a different award', { targetId: 'award-other' }],
      ['written for a priority, not an award', { targetType: 'priority' }],
      ['naming a different revision', { rev: 2 }],
      ['signed with someone else', { by: UID.member }],
      ['with a client-chosen time', { at: new Date('2026-01-01T00:00:00Z') }],
      ['with a made-up display name', { byName: 'Somebody Else' }],
      ['with an unknown action', { action: 'tweak' }],
      ['with an unknown target type', { targetType: 'raid' }],
      ['with an extra field', { note: 'extra' }],
      ['missing the list of changed fields', { changed: undefined }],
    ]
    for (const [what, overrides] of brokenEntries) {
      test(`an edit whose audit entry is ${what} is refused`, async () => {
        await expectDenied(editAward(dbFor(who), who, { audit: overrides }))
      })
    }

    test('an entry filed under another id than {type}_{targetId}_{rev} is refused', async () => {
      await expectDenied(editAward(dbFor(who), who, { entryKey: 'free-form-id' }))
      await expectDenied(editAward(dbFor(who), who, { entryKey: `${AWARD}_1` }), 'the old id without the type')
    })

    // The entry has to say what happened. These all change an award honestly but log something else.
    const lies: [string, DocumentData, DocumentData][] = [
      ['an item name that is not the award\'s', { recipient: PLAYER_3 }, { item: 'Totally Different Item' }],
      ['a changed list that names no change', { recipient: PLAYER_3 }, { changed: [], before: {}, after: {} }],
      ['a changed list that names another field', { recipient: PLAYER_3 }, { changed: ['awardNote'], before: { awardNote: '' }, after: { awardNote: '' } }],
      ['a changed list that leaves a change out', { recipient: PLAYER_3, awardNote: 'Swapped' }, { changed: ['recipient'], before: { recipient: PLAYER_2 }, after: { recipient: PLAYER_3 } }],
      ['a changed list with a field twice', { recipient: PLAYER_3 }, { changed: ['recipient', 'recipient'] }],
      ['a changed list with something that is not a field name', { recipient: PLAYER_3 }, { changed: ['recipient', 5] }],
      ['an old value that is not the stored one', { recipient: PLAYER_3 }, { before: { recipient: PLAYER_1 } }],
      ['a new value that is not the stored one', { recipient: PLAYER_3 }, { after: { recipient: PLAYER_1 } }],
      ['a before map with a field that did not change', { recipient: PLAYER_3 }, { before: { recipient: PLAYER_2, awardNote: '' } }],
      ['an after map with a field that did not change', { recipient: PLAYER_3 }, { after: { recipient: PLAYER_3, awardNote: '' } }],
      ['no old value', { recipient: PLAYER_3 }, { before: {} }],
      ['an action of remove for a plain edit', { recipient: PLAYER_3 }, { action: 'remove', reason: 'Gear was swapped' }],
    ]
    for (const [what, changes, audit] of lies) {
      test(`an entry with ${what} is refused`, async () => {
        await expectDenied(editAward(dbFor(who), who, { changes, audit }))
      })
    }

    test('a removal logged as a plain edit, or with another reason than the award carries, is refused', async () => {
      const db = dbFor(who)
      const removal = { status: 'removed', removedReason: 'Gear was swapped' }
      await expectDenied(editAward(db, who, { changes: removal, audit: { action: 'edit', reason: 'Gear was swapped' } }), 'a removal logged as an edit')
      await expectDenied(editAward(db, who, { changes: removal, audit: { action: 'remove', reason: 'A different story' } }), 'two different reasons')
      await expectDenied(editAward(db, who, { changes: removal, audit: { action: 'remove' } }), 'no reason on the entry')
    })

    test('an entry cannot be filed as a reorder or a delete for an award', async () => {
      await expectDenied(editAward(dbFor(who), who, { audit: { action: 'delete' } }))
      await expectDenied(editAward(dbFor(who), who, { audit: { action: 'reorder' } }))
    })

    // The snapshot is what the award was decided with; who made the award and when never changes either.
    const frozen: [string, DocumentData][] = [
      ['the candidate order it was decided with', { prioritySnapshot: [PLAYER_3, PLAYER_2, PLAYER_1] }],
      ['the council note it was decided with', { councilNoteSnapshot: 'Rewritten note' }],
      ['the priority it came from', { priorityId: 'priority-2' }],
      ['who created it', { createdBy: UID.member }],
      ['when it was created', { createdAt: serverTimestamp() }],
    ]
    for (const [what, change] of frozen) {
      test(`an edit that changes ${what} is refused, even with a matching entry`, async () => {
        await expectDenied(editAward(dbFor(who), who, { changes: change }))
      })
    }

    test('who created an award and when cannot be changed or removed once recorded', async () => {
      await asAdmin((db) => setDoc(guildDoc(db, 'awards/award-2'), stampedAward()))
      const db = dbFor(who)
      await expectDenied(editAward(db, who, { awardId: 'award-2', rev: 4, changes: { createdBy: UID.member } }), 'another creator')
      await expectDenied(editAward(db, who, { awardId: 'award-2', rev: 4, changes: { createdAt: new Date('2026-01-01T00:00:00Z') } }), 'another creation time')
      // A deleted field cannot be written into the entry, so these entries just say nothing changed.
      const nothing = { changed: [], before: {}, after: {} }
      await expectDenied(editAward(db, who, { awardId: 'award-2', rev: 4, changes: { createdBy: deleteField() }, audit: nothing }), 'removing the creator')
      await expectDenied(editAward(db, who, { awardId: 'award-2', rev: 4, changes: { createdAt: deleteField() }, audit: nothing }), 'removing the creation time')
      await expectAllowed(editAward(db, who, { awardId: 'award-2', rev: 4 }), 'a plain edit of the stamped award')
    })

    test('an award that never had a creator cannot be given one by an edit', async () => {
      await expectDenied(editAward(dbFor(who), who, { changes: { createdBy: UID[who] } }))
    })

    const invalidFields: [string, DocumentData][] = [
      ['an empty item', { item: '' }],
      ['an item that is a number', { item: 7 }],
      ['an item that is a list', { item: ['x'] }],
      ['an item over 120 characters', { item: 'x'.repeat(121) }],
      ['an encounter over 120 characters', { encounter: 'x'.repeat(121) }],
      ['an encounter that is a number', { encounter: 7 }],
      ['an encounter that is a list', { encounter: ['x'] }],
      ['an empty recipient', { recipient: '' }],
      ['a recipient that is a list', { recipient: ['x'] }],
      ['a recipient over 60 characters', { recipient: 'x'.repeat(61) }],
      ['a date that is not YYYY-MM-DD', { awardedAt: '12/09/2026' }],
      ['a note that is a list', { awardNote: ['x'] }],
      ['a note that is a map', { awardNote: { text: 'hello' } }],
      ['a note over 500 characters', { awardNote: 'x'.repeat(501) }],
      ['a status that is not active or removed', { status: 'archived' }],
      ['a recipientId that is a number', { recipientId: 9 }],
      ['a recipientId that is a list', { recipientId: ['x'] }],
      ['a recipientId over 100 characters', { recipientId: 'x'.repeat(101) }],
      ['a removedReason that is a list while the award stays active', { removedReason: ['x'] }],
      ['a removedReason over 300 characters while the award stays active', { removedReason: 'x'.repeat(301) }],
      ['an extra field', { favorite: true }],
    ]
    for (const [what, change] of invalidFields) {
      test(`an edit with ${what} is refused`, async () => {
        await expectDenied(editAward(dbFor(who), who, { changes: change }))
      })
    }

    test('the limits themselves are accepted', async () => {
      await expectAllowed(editAward(dbFor(who), who, { changes: { item: 'x'.repeat(120), encounter: 'x'.repeat(120), recipient: 'x'.repeat(60), recipientId: 'x'.repeat(100), awardNote: 'x'.repeat(500) } }))
    })

    test('an edit can change item, encounter, recipient, date, note and roster id together', async () => {
      await expectAllowed(editAward(dbFor(who), who, { changes: { item: 'Corrected Sword', encounter: 'Corrected Boss', recipient: PLAYER_1, recipientId: 'roster-1', awardedAt: '2026-12-10', awardNote: 'Swapped gear' } }))
    })

    test('the edit must be stamped with the editor and the server time', async () => {
      await expectDenied(editAward(dbFor(who), who, { award: { updatedBy: UID.member } }), 'someone else as the editor')
      await expectDenied(editAward(dbFor(who), who, { award: { updatedAt: new Date('2026-01-01T00:00:00Z') } }), 'a client-chosen edit time')
      await expectDenied(editAward(dbFor(who), who, { award: { updatedBy: undefined } }), 'no editor')
    })

    // "Removing" an award is an edit: the document stays, marked removed, with a reason.
    test('removing needs a reason on the award and on the entry, and the two must agree', async () => {
      const db = dbFor(who)
      const remove = (award: DocumentData, audit: DocumentData) => editAward(db, who, { changes: { status: 'removed', ...award }, audit: { action: 'remove', ...audit } })
      await expectDenied(remove({}, { reason: 'Gear was swapped' }), 'a removal with no removedReason on the award')
      await expectDenied(remove({ removedReason: '' }, { reason: 'Gear was swapped' }), 'an empty removedReason')
      await expectDenied(remove({ removedReason: '   ' }, { reason: '   ' }), 'a removedReason of spaces')
      await expectDenied(remove({ removedReason: 'x'.repeat(301) }, { reason: 'Gear was swapped' }), 'a removedReason over 300 characters')
      await expectDenied(remove({ removedReason: 'Gear was swapped' }, {}), 'a remove entry with no reason')
      await expectDenied(remove({ removedReason: 'Gear was swapped' }, { reason: '' }), 'a remove entry with an empty reason')
      await expectDenied(remove({ removedReason: ['Gear was swapped'] }, { reason: 'Gear was swapped' }), 'a removedReason that is a list')
      await expectAllowed(remove({ removedReason: 'Gear was swapped' }, { reason: 'Gear was swapped' }))
      assert.equal((await stored(`awards/${AWARD}`))?.status, 'removed')
      assert.ok(await stored(`awards/${AWARD}`), 'the award is still there')
    })

    test('a removed award can be restored', async () => {
      const db = dbFor(who)
      await expectAllowed(editAward(db, who, { rev: 1, changes: { status: 'removed', removedReason: 'Entered by mistake' }, audit: { action: 'remove', reason: 'Entered by mistake' } }))
      await expectAllowed(editAward(db, who, { rev: 2, changes: { status: 'active' } }))
      assert.equal((await stored(`awards/${AWARD}`))?.status, 'active')
    })

    test('an award can never be deleted, with or without an entry', async () => {
      const db = dbFor(who)
      await expectDenied(deleteDoc(guildDoc(db, `awards/${AWARD}`)))
      const batch = writeBatch(db)
      batch.delete(guildDoc(db, `awards/${AWARD}`))
      batch.set(guildDoc(db, `auditLog/${entryId('award', AWARD, 1)}`), entry(who, 'award', AWARD, 1, { action: 'delete' }))
      await expectDenied(batch.commit())
      assert.ok(await stored(`awards/${AWARD}`))
    })
  })
}

// The entry id carries the target type, so an award and a priority with the same id cannot get in each other's way.
describe('entry ids and revisions', () => {
  test('a priority with the id of an award does not block that award\'s edits', async () => {
    const db = dbFor('raidLeader')
    await expectAllowed(createPriority(db, 'raidLeader', { id: AWARD }), 'writing a priority that has the award\'s id, with its create entry')
    await expectAllowed(editAward(db, 'raidLeader'), 'the honest edit of the award')
  })

  test('a priority entry cannot be filed under an award entry id, nor the other way round', async () => {
    const db = dbFor('raidLeader')
    await expectDenied(reorderPriority(db, 'raidLeader', { entryKey: entryId('award', PRIORITY_ID, 1) }))
    await expectDenied(editAward(db, 'raidLeader', { entryKey: entryId('priority', AWARD, 1) }))
  })

  test('an edit cannot borrow an entry that was written for a priority', async () => {
    const db = dbFor('raidLeader')
    await expectDenied(editAward(db, 'raidLeader', { audit: { targetType: 'priority' } }))
  })

  // The SDK writes whole numbers as integers, so this takes a hand-built request, like a modified browser would send.
  describe('a revision that is a double', () => {
    const rawEdit = (uid: string | null, rev: unknown, entryRev: unknown = 1) =>
      rawCommit(uid, [
        { path: `awards/${AWARD}`, mask: ['recipient', 'rev', 'updatedBy', 'updatedAt'], fields: { recipient: PLAYER_3, rev, updatedBy: UID.raidLeader, updatedAt: requestTime } },
        {
          path: `auditLog/${entryId('award', AWARD, 1)}`,
          fields: { at: requestTime, by: UID.raidLeader, byName: displayNameOf(UID.raidLeader), targetType: 'award', targetId: AWARD, rev: entryRev, action: 'edit', item: 'Test Sword', changed: ['recipient'], before: { recipient: PLAYER_2 }, after: { recipient: PLAYER_3 } },
        },
      ])

    test('the raw request is checked by the rules: a Raid Leader\'s integer revision is accepted, anyone else\'s is refused', async () => {
      assert.equal(await rawEdit(null, 1), 'denied', 'signed out')
      assert.equal(await rawEdit(UID.member, 1), 'denied', 'a Member')
      assert.equal(await rawEdit('uid-nobody', 1), 'denied', 'someone who is not in the guild')
      assert.equal(await rawEdit(UID.raidLeader, 1), 'allowed')
      assert.equal((await stored(`awards/${AWARD}`))?.rev, 1)
    })

    test('an award revision of 1.0 is refused, because the next entry id could never be built', async () => {
      assert.equal(await rawEdit(UID.raidLeader, asDouble(1)), 'denied')
      assert.equal((await stored(`awards/${AWARD}`))?.rev, undefined)
    })

    test('an entry revision of 1.0 or 1.5 is refused', async () => {
      assert.equal(await rawEdit(UID.raidLeader, 1, asDouble(1)), 'denied')
      assert.equal(await rawEdit(UID.raidLeader, 1, asDouble(1.5)), 'denied')
    })

    test('an award that already holds a double revision cannot be edited, and is the reason the rule requires integers', async () => {
      await asAdmin((db) => setDoc(guildDoc(db, 'awards/award-2'), awardDoc({ rev: 1.5 })))
      await expectDenied(editAward(dbFor('raidLeader'), 'raidLeader', { awardId: 'award-2', rev: 2.5 }))
    })
  })
})

// An entry stands for one real change, so it can only be written together with that change.
describe('audit entries for priorities', () => {
  test('a new priority at revision 1 can be created with a create entry that lists its fields', async () => {
    await expectAllowed(createPriority(dbFor('raidLeader'), 'raidLeader'))
    const logged = await stored(`auditLog/${entryId('priority', 'priority-2', 1)}`)
    assert.equal(logged?.action, 'create')
    assert.deepEqual([...(logged?.changed as string[])].sort(), Object.keys(newPriorityDoc()).sort())
  })

  test('a create entry is refused for a priority that already exists, at a revision other than 1, or that lists other fields', async () => {
    const db = dbFor('raidLeader')
    const create = (id: string, docRev: number | undefined, entryRev: number, audit: DocumentData = {}, extra: DocumentData = {}) => {
      const fields = newPriorityDoc(extra)
      const batch = writeBatch(db)
      batch.set(guildDoc(db, `lootPriorities/${id}`), clean({ ...fields, rev: docRev, updatedBy: UID.raidLeader, updatedAt: serverTimestamp() }))
      batch.set(guildDoc(db, `auditLog/${entryId('priority', id, entryRev)}`), clean(entry('raidLeader', 'priority', id, entryRev, { action: 'create', ...describeChange(undefined, fields), ...audit })))
      return batch.commit()
    }
    await expectDenied(create(PRIORITY_ID, 1, 1), 'a priority that already exists')
    await expectDenied(create('priority-2', 1, 2), 'an entry that says revision 2 for a priority created at revision 1')
    await expectDenied(create('priority-2', 5, 1), 'a priority created at revision 5')
    await expectDenied(create('priority-2', undefined, 1), 'a priority created with no revision')
    await expectDenied(create('priority-2', 1, 1, { changed: ['item'] }), 'an entry that lists only some of the fields')
    await expectDenied(create('priority-2', 1, 1, {}, { surprise: 'x' }), 'a priority with a field the entry cannot describe')
    await expectAllowed(create('priority-2', 1, 1))
  })

  test('a reorder with its entry is accepted; the revision must go up by one', async () => {
    const db = dbFor('guildLeader')
    await expectDenied(reorderPriority(db, 'guildLeader', { rev: 2 }), 'jumping to revision 2')
    await expectAllowed(reorderPriority(db, 'guildLeader', { rev: 1 }))
    await expectAllowed(reorderPriority(db, 'guildLeader', { rev: 2, order: [PLAYER_2, PLAYER_1, PLAYER_3] }))
  })

  test('a reorder entry has to list exactly the candidate order', async () => {
    const db = dbFor('raidLeader')
    await expectDenied(reorderPriority(db, 'raidLeader', { audit: { changed: ['councilNote'] } }))
    await expectDenied(reorderPriority(db, 'raidLeader', { audit: { action: 'edit', before: { rankedPlayers: [PLAYER_1] } } }), 'a wrong old order')
    await expectDenied(reorderPriority(db, 'raidLeader', { audit: { after: { rankedPlayers: [PLAYER_1] } } }), 'a wrong new order')
    await expectDenied(reorderPriority(db, 'raidLeader', { audit: { action: 'reorder', item: 'Another Item' } }), 'a wrong item')
  })

  test('deleting a priority is logged with a delete entry for the next revision and the old values', async () => {
    const db = dbFor('raidLeader')
    const current = await stored(`lootPriorities/${PRIORITY_ID}`)
    const remove = (rev: number, audit: DocumentData = {}) => {
      const batch = writeBatch(db)
      batch.delete(guildDoc(db, `lootPriorities/${PRIORITY_ID}`))
      const data = entry('raidLeader', 'priority', PRIORITY_ID, rev, { action: 'delete', item: current?.item, changed: ['item', 'encounter', 'rankedPlayers', 'councilNote'], before: current, ...audit })
      batch.set(guildDoc(db, `auditLog/${entryId('priority', PRIORITY_ID, rev)}`), data)
      return batch.commit()
    }
    await expectDenied(remove(3), 'the wrong revision')
    await expectDenied(remove(1, { before: { item: 'Test Sword' }, changed: ['item'] }), 'old values that leave fields out')
    await expectAllowed(remove(1))
    assert.equal(await stored(`lootPriorities/${PRIORITY_ID}`), undefined)
  })

  test('a delete entry while the priority is still there is refused', async () => {
    await expectDenied(setDoc(guildDoc(dbFor('raidLeader'), `auditLog/${entryId('priority', PRIORITY_ID, 1)}`), entry('raidLeader', 'priority', PRIORITY_ID, 1, { action: 'delete' })))
  })

  test('an existing entry cannot be rewritten, even by a request that passes every entry check', async () => {
    const db = dbFor('raidLeader')
    await expectAllowed(reorderPriority(db, 'raidLeader', { rev: 1 }))
    // Wind the priority's revision back behind the rules' back (an admin tool, say), so that revision 1 is open again. The entry for it is
    // already stored, and an entry can never be rewritten, whatever the target looks like.
    await asAdmin((admin) => setDoc(guildDoc(admin, `lootPriorities/${PRIORITY_ID}`), priorityDoc({ rev: 0 })))
    const before = await stored(`auditLog/${entryId('priority', PRIORITY_ID, 1)}`)
    await expectDenied(reorderPriority(db, 'raidLeader', { rev: 1, audit: { reason: 'history rewritten' } }), 'overwriting an existing entry')
    assert.deepEqual(await stored(`auditLog/${entryId('priority', PRIORITY_ID, 1)}`), before)
  })

  test('a priority entry cannot be filed as a remove, and an unknown action or type is refused', async () => {
    const db = dbFor('raidLeader')
    await expectDenied(reorderPriority(db, 'raidLeader', { audit: { action: 'remove', reason: 'No' } }))
    await expectDenied(reorderPriority(db, 'raidLeader', { audit: { action: 'tweak' } }))
    await expectDenied(reorderPriority(db, 'raidLeader', { audit: { targetType: 'raid' } }))
    await expectDenied(reorderPriority(db, 'raidLeader', { audit: { item: ['Test Sword'] } }))
    await expectDenied(reorderPriority(db, 'raidLeader', { audit: { reason: ['why'] } }))
  })

  test('target ids have to be plain: letters, digits, dashes and underscores, at most 100', async () => {
    const id = 'a'.repeat(101)
    await asAdmin((db) => setDoc(guildDoc(db, `awards/${id}`), awardDoc()))
    await expectDenied(editAward(dbFor('raidLeader'), 'raidLeader', { awardId: id }))
    await asAdmin((db) => setDoc(guildDoc(db, 'awards/award.dot'), awardDoc()))
    await expectDenied(editAward(dbFor('raidLeader'), 'raidLeader', { awardId: 'award.dot' }))
    await asAdmin((db) => setDoc(guildDoc(db, `awards/${'a'.repeat(100)}`), awardDoc()))
    await expectAllowed(editAward(dbFor('raidLeader'), 'raidLeader', { awardId: 'a'.repeat(100) }))
  })

  // Stage 3: a priority is never written without its entry, by anyone, whatever else the write gets right.
  for (const who of RAID_STAFF as readonly Staff[]) {
    test(`a priority write without its entry is refused for a ${LABEL[who]}, even with every stamp in place`, async () => {
      const db = dbFor(who)
      await expectDenied(updateDoc(guildDoc(db, `lootPriorities/${PRIORITY_ID}`), { rankedPlayers: [PLAYER_3, PLAYER_2, PLAYER_1] }), 'a plain reorder')
      await expectDenied(editPriority(db, who, { skipEntry: true }), 'a stamped edit')
      await expectDenied(createPriority(db, who, { skipEntry: true }), 'a stamped create')
      await expectDenied(deletePriority(db, who, { skipEntry: true }), 'a delete')
      await expectDenied(setDoc(guildDoc(db, 'lootPriorities/priority-plain'), priorityDoc()), 'a plain create')
      await expectDenied(deleteDoc(guildDoc(db, `lootPriorities/${PRIORITY_ID}`)), 'a plain delete')
      assert.deepEqual(await stored(`lootPriorities/${PRIORITY_ID}`), priorityDoc())
    })
  }
})

// match /auditLog/{entryId}: read, create, update and delete
describe('who can use the audit log', () => {
  const entryPath = `auditLog/${entryId('award', AWARD, 1)}`

  for (const who of PERSONAS) {
    test(`the ${LABEL[who]} ${ANY_ROLE.includes(who) ? 'can' : 'cannot'} read and list the log`, async () => {
      await expectAllowed(editAward(dbFor('guildLeader'), 'guildLeader'))
      const db = dbFor(who)
      const read = async () => {
        await getDoc(guildDoc(db, entryPath))
        await getDocs(guildCollection(db, 'auditLog'))
      }
      if (ANY_ROLE.includes(who)) await expectAllowed(read())
      else await expectDenied(read())
    })
  }

  for (const who of ['anonymous', 'stranger', 'otherGuildLeader', 'member'] as const) {
    test(`the ${LABEL[who]} cannot update an award or write an entry, even with a matching pair`, async () => {
      const db = dbFor(who)
      const batch = writeBatch(db)
      batch.update(guildDoc(db, `awards/${AWARD}`), { recipient: PLAYER_3, rev: 1, updatedBy: uidOf(who), updatedAt: serverTimestamp() })
      batch.set(guildDoc(db, entryPath), { ...entry('raidLeader', 'award', AWARD, 1, describeChange(awardDoc(), { recipient: PLAYER_3 })), by: uidOf(who), byName: displayNameOf(uidOf(who)) })
      await expectDenied(batch.commit())
      assert.equal(await stored(entryPath), undefined)
      await expectDenied(updateDoc(guildDoc(db, `awards/${AWARD}`), { recipient: PLAYER_3, rev: 1, updatedBy: uidOf(who), updatedAt: serverTimestamp() }), 'the award alone, with the entry already present')
    })
  }

  test('only Guild and Raid Leaders may update an award, even when the entry for the next revision already exists', async () => {
    await asAdmin((db) => setDoc(guildDoc(db, entryPath), { at: new Date(), by: UID.raidLeader, byName: displayNameOf(UID.raidLeader), targetType: 'award', targetId: AWARD, rev: 1, action: 'edit', item: 'Test Sword', changed: ['recipient'] }))
    for (const who of ['member', 'stranger', 'otherGuildLeader', 'anonymous'] as const) {
      await expectDenied(updateDoc(guildDoc(dbFor(who), `awards/${AWARD}`), { recipient: PLAYER_3, rev: 1, updatedBy: uidOf(who), updatedAt: serverTimestamp() }), `the ${LABEL[who]}`)
    }
    assert.equal((await stored(`awards/${AWARD}`))?.recipient, PLAYER_2)
  })

  for (const who of PERSONAS) {
    test(`the ${LABEL[who]} cannot edit or delete an entry`, async () => {
      await expectAllowed(editAward(dbFor('guildLeader'), 'guildLeader'))
      const before = await stored(entryPath)
      const db = dbFor(who)
      await expectDenied(updateDoc(guildDoc(db, entryPath), { reason: 'Rewritten' }), 'editing an entry')
      await expectDenied(setDoc(guildDoc(db, entryPath), entry('guildLeader', 'award', AWARD, 1, { reason: 'Replaced' })), 'replacing an entry')
      await expectDenied(deleteDoc(guildDoc(db, entryPath)), 'deleting an entry')
      assert.deepEqual(await stored(entryPath), before)
    })
  }

  test('a reason longer than 300 characters or of the wrong type is refused', async () => {
    await expectDenied(editAward(dbFor('raidLeader'), 'raidLeader', { audit: { reason: 'x'.repeat(301) } }))
    await expectDenied(editAward(dbFor('raidLeader'), 'raidLeader', { audit: { reason: 5 } }))
    await expectAllowed(editAward(dbFor('raidLeader'), 'raidLeader', { audit: { reason: 'x'.repeat(300) } }))
  })

  test('before and after must be maps, and changed must be a list of at most 20 fields', async () => {
    await expectDenied(editAward(dbFor('raidLeader'), 'raidLeader', { audit: { before: 'old' } }))
    await expectDenied(editAward(dbFor('raidLeader'), 'raidLeader', { audit: { after: ['new'] } }))
    await expectDenied(editAward(dbFor('raidLeader'), 'raidLeader', { audit: { changed: 'recipient' } }))
    await expectDenied(editAward(dbFor('raidLeader'), 'raidLeader', { audit: { changed: Array.from({ length: 21 }, (_, i) => `f${i}`) } }))
  })

  test('the item label has to be the award\'s item', async () => {
    await expectDenied(editAward(dbFor('raidLeader'), 'raidLeader', { audit: { item: 'x'.repeat(121) } }))
    await expectDenied(editAward(dbFor('raidLeader'), 'raidLeader', { audit: { item: ['Test Sword'] } }))
  })
})

// Every audited edit costs the rules a few document lookups, and a batch only gets 20. Hitting the limit is
// reported as the same PERMISSION_DENIED as a real refusal, so the largest batch that works is pinned here.
describe('how many audited edits fit in one batch', () => {
  const edits = async (count: number) => {
    const db = dbFor('raidLeader')
    const ids = Array.from({ length: count }, (_, i) => `award-batch-${i}`)
    await asAdmin(async (admin) => {
      for (const id of ids) await setDoc(guildDoc(admin, `awards/${id}`), awardDoc())
    })
    const batch = writeBatch(db)
    for (const id of ids) {
      batch.update(guildDoc(db, `awards/${id}`), { recipient: PLAYER_3, ...stamp('raidLeader', 1) })
      batch.set(guildDoc(db, `auditLog/${entryId('award', id, 1)}`), entry('raidLeader', 'award', id, 1, describeChange(awardDoc(), { recipient: PLAYER_3 })))
    }
    return batch.commit()
  }

  test('18 audited edits fit in one batch', async () => {
    await expectAllowed(edits(18))
  })

  // KNOWN GAP: the client writes one audited edit at a time, but a bulk operation (importing loot) would write many.
  // A batch of 19 is refused for lack of lookups, not for any rule; if a later change adds lookups this number goes down.
  test('KNOWN GAP: the lookup limit stops a batch of 19 audited edits', async () => {
    await expectDenied(edits(19))
  })
})
