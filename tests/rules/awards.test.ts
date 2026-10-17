// Loot awards made from a priority: the awards block of firestore.rules, the snapshot check it calls (hasPrioritySnapshot) and the
// create rule validPriorityAward.
//
// An award stores a snapshot of the candidate order and the council note as they were when it was decided, and nobody can change or
// delete it afterwards without an audit entry. A new award is accepted only when its snapshot matches the stored priority exactly, it has
// exactly the expected fields with the stamps the rules set (rev 1, createdBy, createdAt), it is filed under the current phase, and its
// audit entry (type 'award', revision 1) is in the same batch. Guild Leaders and Raid Leaders follow the same rule: there is no exception.
// Manual awards (no priority) are in manual-awards.test.ts; the entry rules are in audit.test.ts and audit-details.test.ts.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { addDoc, deleteDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { LABEL, PLAYER_1, PLAYER_2, PLAYER_3, PRIORITY_ID, RAID_STAFF, UID, awardDoc, priorityDoc, without } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildCollection, guildDoc, setUpGuildEmulator, stored } from './support/harness.ts'
import { clean, createAward, deletePriority, describeChange, editPriority, entry, entryId, newAwardDoc, stamp, type Staff } from './support/audit.ts'

setUpGuildEmulator()

/** Put the guild in phase `n`: n finished phases in its settings. */
const inPhase = (n: number) => asAdmin((db) => setDoc(guildDoc(db, 'settings/general'), { currentPhase: `Phase ${n}`, nextPhase: 'Next', phaseHistory: Array.from({ length: n }, (_, index) => `Earlier ${index}`) }))
/** Store the seeded priority again, filed under phase `n`. */
const priorityInPhase = (n: number) => asAdmin((db) => setDoc(guildDoc(db, `lootPriorities/${PRIORITY_ID}`), priorityDoc({ phaseNo: n })))

for (const who of RAID_STAFF as readonly Staff[]) {
  const award = (fields: Record<string, unknown>, extra: Parameters<typeof createAward>[2] = {}) => createAward(dbFor(who), who, { fields, ...extra })

  // The snapshot, council note, item and encounter must equal the stored priority's, the recipient must be on its list, and priorityId must
  // name an existing priority. Any difference is refused.
  describe(`a ${LABEL[who]}'s award must match the stored priority`, () => {
    test('an award that copies the priority exactly is accepted', async () => {
      await expectAllowed(award(newAwardDoc()))
    })

    test('the last candidate on the list can receive it', async () => {
      await expectAllowed(award(newAwardDoc({ recipient: PLAYER_3 })))
    })

    const mismatches: [string, Record<string, unknown>][] = [
      ['a snapshot missing a candidate', { prioritySnapshot: [PLAYER_1, PLAYER_2] }],
      ['a snapshot with an extra candidate', { prioritySnapshot: [PLAYER_1, PLAYER_2, PLAYER_3, 'player-4'] }],
      ['a snapshot in a different order', { prioritySnapshot: [PLAYER_2, PLAYER_1, PLAYER_3] }],
      ['an empty snapshot', { prioritySnapshot: [] }],
      ['a snapshot that is not a list', { prioritySnapshot: 'player-1,player-2,player-3' }],
      ['a different council note', { councilNoteSnapshot: 'Tampered note' }],
      ['a different item', { item: 'Test Axe' }],
      ['a different encounter', { encounter: 'Other Boss' }],
      ['a recipient who is not on the list', { recipient: 'player-9' }],
      ['a priorityId that names no priority', { priorityId: 'priority-404' }],
    ]
    for (const [what, overrides] of mismatches) {
      test(`an award with ${what} is refused`, async () => {
        await expectDenied(award(newAwardDoc(overrides)))
      })
    }

    // A number in a path becomes its text, so priorityId 42 would find the priority "42" if there is one. With one in place, the `is string`
    // test in the rules is the only thing that can refuse the award.
    test('an award with a priorityId that is a number is refused even when a priority has that id', async () => {
      await asAdmin((db) => setDoc(guildDoc(db, 'lootPriorities/42'), priorityDoc()))
      await expectDenied(award(newAwardDoc({ priorityId: 42 })))
    })
  })

  describe(`the shape of a ${LABEL[who]}'s award`, () => {
    for (const field of ['priorityId', 'item', 'encounter', 'recipient', 'awardedAt', 'prioritySnapshot', 'councilNoteSnapshot', 'awardNote', 'phaseNo']) {
      test(`an award with no ${field} is refused`, async () => {
        await expectDenied(award(without(newAwardDoc(), field)))
      })
    }

    const bad: [string, Record<string, unknown>][] = [
      ['an unknown field', { extra: 'anything' }],
      ['a recipient id the app does not write yet', { recipientId: PLAYER_2 }],
      ['a decision, which only a manual award has', { decision: 'roll' }],
      ['a status', { status: 'removed' }],
      ['a date that is not a date', { awardedAt: 'not a date' }],
      ['a date that is a number', { awardedAt: 20261209 }],
      ['a note over 500 characters', { awardNote: 'x'.repeat(501) }],
      ['a note that is not text', { awardNote: 5 }],
      ['a recipient over 60 characters', { recipient: 'x'.repeat(61), prioritySnapshot: ['x'.repeat(61)] }],
    ]
    for (const [what, overrides] of bad) {
      test(`an award with ${what} is refused`, async () => {
        // The priority the award copies has to say the same, so the award's own checks are what refuse it.
        if ('prioritySnapshot' in overrides) await asAdmin((db) => setDoc(guildDoc(db, `lootPriorities/${PRIORITY_ID}`), priorityDoc({ rankedPlayers: overrides.prioritySnapshot })))
        await expectDenied(award(newAwardDoc(overrides)))
      })
    }

    test('the longest allowed note is accepted', async () => {
      await expectAllowed(award(newAwardDoc({ awardNote: 'x'.repeat(500) })))
    })

    // The stamps are set by the rules' own checks, never by the client's say-so.
    const stamps: [string, Record<string, unknown>][] = [
      ['a revision other than 1', { rev: 2 }],
      ['a revision that is text', { rev: '1' }],
      ['someone else as the creator', { createdBy: UID[who === 'guildLeader' ? 'raidLeader' : 'guildLeader'] }],
      ['a creation time from the client', { createdAt: new Date('2026-01-01T00:00:00Z') }],
      ['updatedBy and updatedAt, which a new award has none of', { updatedBy: UID[who], updatedAt: serverTimestamp() }],
    ]
    for (const [what, overrides] of stamps) {
      test(`an award with ${what} is refused`, async () => {
        await expectDenied(award(newAwardDoc(), { award: overrides }))
      })
    }
  })

  describe(`the audit entry of a ${LABEL[who]}'s award`, () => {
    test('an award without its entry is refused', async () => {
      await expectDenied(award(newAwardDoc(), { skipEntry: true }))
    })
    test('an entry filed under another award is refused', async () => {
      await expectDenied(award(newAwardDoc(), { entryKey: entryId('award', 'someone-else', 1) }))
    })
    test('an entry that lists a different recipient is refused', async () => {
      await expectDenied(award(newAwardDoc(), { audit: { after: { ...newAwardDoc(), recipient: PLAYER_3 } } }))
    })
    test('the entry is stored, and says who recorded it and what', async () => {
      await expectAllowed(award(newAwardDoc({ recipient: PLAYER_3 })))
      const logged = await stored(`auditLog/${entryId('award', 'award-new', 1)}`)
      assert.equal(logged?.by, UID[who])
      assert.equal(logged?.action, 'create')
      assert.equal(logged?.after?.recipient, PLAYER_3)
      assert.equal((await stored('awards/award-new'))?.createdBy, UID[who])
    })
  })

  // An award is recorded in the current phase, from a priority of that phase, and carries that phase's number. The seeded priority has no
  // phase number, which means the first phase.
  describe(`the loot phase of a ${LABEL[who]}'s award`, () => {
    test('an award with a valid phase number is accepted when it is the current phase', async () => {
      await expectAllowed(award(newAwardDoc({ phaseNo: 0 })))
    })

    for (const [what, phaseNo] of [['-5', -5], ['1.5', 1.5], ['31', 31], ['9999', 9999], ['text', '0'], ['null', null], ['a list', [0]], ['a map', { n: 0 }], ['true', true]] as [string, unknown][]) {
      test(`an award with a phase number of ${what} is refused`, async () => {
        await expectDenied(award(newAwardDoc({ phaseNo })))
      })
    }

    test('an award in another phase than the current one is refused', async () => {
      await expectDenied(award(newAwardDoc({ phaseNo: 1 })), 'a later phase')
      await inPhase(2)
      await priorityInPhase(0)
      await expectDenied(award(newAwardDoc({ phaseNo: 0 })), 'an earlier phase')
    })

    test('an award has to carry the phase its priority is filed under', async () => {
      await inPhase(1)
      await priorityInPhase(1)
      await expectAllowed(award(newAwardDoc({ phaseNo: 1 })), 'the same phase')
      await expectDenied(award(newAwardDoc({ phaseNo: 0 }), { id: 'award-other' }), 'the earlier phase while the priority is in the current one')
    })

    // The award has to be in the current phase and so does the priority it copies, so it cannot claim the current phase for a priority that
    // is filed under another one.
    test('an award that claims the current phase cannot be made from a priority of a finished phase or of the next one', async () => {
      await inPhase(1)
      await priorityInPhase(0)
      await expectDenied(award(newAwardDoc({ phaseNo: 1 })), 'a priority of a finished phase')
      await priorityInPhase(2)
      await expectDenied(award(newAwardDoc({ phaseNo: 1 })), 'a priority of the next phase')
      await priorityInPhase(1)
      await expectAllowed(award(newAwardDoc({ phaseNo: 1 })), 'a priority of the current phase')
    })

    test('nothing can be awarded from a finished phase, or from the next phase', async () => {
      await inPhase(2)
      await priorityInPhase(1)
      await expectDenied(award(newAwardDoc({ phaseNo: 1 })), 'a finished phase')
      await priorityInPhase(3)
      await expectDenied(award(newAwardDoc({ phaseNo: 3 })), 'the next phase')
      await priorityInPhase(2)
      await expectAllowed(award(newAwardDoc({ phaseNo: 2 })), 'the current phase')
    })
  })
}

const reordered = [PLAYER_3, PLAYER_2, PLAYER_1]

describe('an award and the priority it copies', () => {
  test('an award built before the priority changed is refused afterwards', async () => {
    const stale = newAwardDoc() // what the dialog captured when it opened
    await expectAllowed(editPriority(dbFor('guildLeader'), 'guildLeader', { changes: { rankedPlayers: reordered } }), 'someone reorders the priority')
    await expectDenied(createAward(dbFor('raidLeader'), 'raidLeader', { fields: stale }), 'the stale award')
    await expectAllowed(createAward(dbFor('raidLeader'), 'raidLeader', { fields: newAwardDoc({ prioritySnapshot: reordered }) }), 'an award built from the new order')
  })

  // The snapshot is compared with the priority as it was before the batch, so an award batched together with an edit to its own priority
  // has to describe the order from before the edit.
  const editPriorityAndAward = (snapshot: string[]) => {
    const db = dbFor('raidLeader')
    const batch = writeBatch(db)
    batch.update(guildDoc(db, `lootPriorities/${PRIORITY_ID}`), { rankedPlayers: reordered, ...stamp('raidLeader', 1) })
    batch.set(guildDoc(db, `auditLog/${entryId('priority', PRIORITY_ID, 1)}`), clean(entry('raidLeader', 'priority', PRIORITY_ID, 1, { item: priorityDoc().item, ...describeChange(priorityDoc(), { rankedPlayers: reordered }) })))
    const fields = newAwardDoc({ prioritySnapshot: snapshot })
    batch.set(guildDoc(db, 'awards/award-new'), { ...fields, rev: 1, createdBy: UID.raidLeader, createdAt: serverTimestamp() })
    batch.set(guildDoc(db, `auditLog/${entryId('award', 'award-new', 1)}`), clean(entry('raidLeader', 'award', 'award-new', 1, { action: 'create', item: fields.item, ...describeChange(undefined, fields) })))
    return batch.commit()
  }

  test('in a batch with a priority edit, an award describing the order before the edit is accepted', async () => {
    await expectAllowed(editPriorityAndAward([PLAYER_1, PLAYER_2, PLAYER_3]))
  })

  test('in a batch with a priority edit, an award describing the order after the edit is refused', async () => {
    await expectDenied(editPriorityAndAward(reordered))
  })

  // KNOWN GAP: the snapshot is compared with the stored priority, which any Raid Leader can edit first. So the check proves the award is
  // consistent with the priority right now, not that the council ever ranked the recipient: a Raid Leader can add anyone to the list and then
  // award them. What changed with the audit rules: each step now needs its entry, so the log shows who added the player to the list and when.
  test('KNOWN GAP: a Raid Leader can edit the priority to add a recipient and then award them, but both steps are in the log', async () => {
    const db = dbFor('raidLeader')
    const rigged = ['player-9', PLAYER_1, PLAYER_2, PLAYER_3]
    await expectAllowed(editPriority(db, 'raidLeader', { changes: { rankedPlayers: rigged } }), 'editing the priority')
    await expectAllowed(createAward(db, 'raidLeader', { fields: newAwardDoc({ recipient: 'player-9', prioritySnapshot: rigged }) }), 'awarding the added player')
    const edit = await stored(`auditLog/${entryId('priority', PRIORITY_ID, 1)}`)
    assert.deepEqual(edit?.changed, ['rankedPlayers'])
    assert.deepEqual(edit?.after, { rankedPlayers: rigged })
    assert.equal(edit?.by, UID.raidLeader)
    assert.equal((await stored(`auditLog/${entryId('award', 'award-new', 1)}`))?.after?.recipient, 'player-9')
  })
})

// match /awards/{awardId}: update and delete
// Delete is always false. An update is accepted only as an audited edit (audit.test.ts); without its entry it is refused.
describe('awards cannot be changed once written', () => {
  for (const who of RAID_STAFF as readonly Staff[]) {
    test(`the ${LABEL[who]} who recorded an award cannot amend or delete it without an entry`, async () => {
      const db = dbFor(who)
      await expectAllowed(createAward(db, who))
      const ref = guildDoc(db, 'awards/award-new')
      const before = await stored('awards/award-new')

      await expectDenied(updateDoc(ref, { prioritySnapshot: [PLAYER_3, PLAYER_2, PLAYER_1] }), 'rewriting the snapshot')
      await expectDenied(updateDoc(ref, { recipient: PLAYER_3 }), 'changing the recipient')
      await expectDenied(setDoc(ref, awardDoc({ recipient: PLAYER_3, phaseNo: 0 })), 'replacing the award')
      await expectDenied(deleteDoc(ref), 'deleting the award')
      assert.deepEqual(await stored('awards/award-new'), before)
    })
  }

  test('an award keeps its snapshot after the priority it came from is changed or deleted', async () => {
    const db = dbFor('raidLeader')
    await expectAllowed(createAward(db, 'raidLeader'))
    await expectAllowed(editPriority(db, 'raidLeader', { changes: { rankedPlayers: [PLAYER_3], councilNote: 'Rewritten' } }))
    await expectAllowed(deletePriority(db, 'raidLeader', { rev: 2 }))
    assert.deepEqual((await stored('awards/award-new'))?.prioritySnapshot, [PLAYER_1, PLAYER_2, PLAYER_3])
    assert.equal((await stored('awards/award-new'))?.councilNoteSnapshot, 'Test council note')
  })

  test('an award cannot be added the old way, as one plain write without an entry', async () => {
    await expectDenied(addDoc(guildCollection(dbFor('raidLeader'), 'awards'), newAwardDoc()))
    await expectDenied(addDoc(guildCollection(dbFor('guildLeader'), 'awards'), newAwardDoc()))
  })
})
