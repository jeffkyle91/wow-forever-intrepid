// Loot awards: the awards block of firestore.rules and the snapshot check it calls (hasPrioritySnapshot).
//
// An award stores a snapshot of the candidate order and the council note as they were when it was decided,
// and nobody can change or delete it afterwards. A Raid Leader's award is only accepted when the snapshot
// matches the stored priority exactly. A Guild Leader's award is accepted as it is.
//
// Tests labeled "KNOWN GAP" pin what the rules do today even though it is arguably wrong or weak. When a
// rules change closes a gap, the matching test fails: flip it to expect a denial and drop the label.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { addDoc, deleteDoc, doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { LABEL, PLAYER_1, PLAYER_2, PLAYER_3, PRIORITY_ID, awardDoc, priorityDoc, without } from './support/fixtures.ts'
import { asAdmin, dbFor, expectAllowed, expectDenied, guildCollection, guildDoc, stored, setUpGuildEmulator } from './support/harness.ts'

setUpGuildEmulator()

const raidLeaderAward = (data: Record<string, unknown>) => addDoc(guildCollection(dbFor('raidLeader'), 'awards'), data)
const guildLeaderAward = (data: Record<string, unknown>) => addDoc(guildCollection(dbFor('guildLeader'), 'awards'), data)

// match /awards/{awardId}: a Raid Leader creates an award
// The snapshot, council note, item and encounter must equal the stored priority's, the recipient must be on
// its list, and priorityId must name an existing priority. Any difference is refused.
describe("a Raid Leader's award must match the stored priority", () => {
  test('an award that copies the priority exactly is accepted', async () => {
    await expectAllowed(raidLeaderAward(awardDoc()))
  })

  test('the last candidate on the list can receive it', async () => {
    await expectAllowed(raidLeaderAward(awardDoc({ recipient: PLAYER_3 })))
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
      await expectDenied(raidLeaderAward(awardDoc(overrides)))
    })
  }

  // The loot phase an award belongs to is optional here (an award from a priority takes its phase from the priority), but if it is there it
  // has to be a real phase number.
  test('an award with a valid phase number is accepted', async () => {
    for (const phaseNo of [0, 1, 30]) await expectAllowed(raidLeaderAward(awardDoc({ phaseNo })), String(phaseNo))
  })
  test('an award with no phase number is accepted, as before phases existed', async () => {
    await expectAllowed(raidLeaderAward(awardDoc()))
  })
  for (const [what, phaseNo] of [['-5', -5], ['1.5', 1.5], ['31', 31], ['9999', 9999], ['text', '1'], ['null', null], ['a list', [1]], ['a map', { n: 1 }], ['true', true]] as [string, unknown][]) {
    test(`an award with a phase number of ${what} is refused`, async () => {
      await expectDenied(raidLeaderAward(awardDoc({ phaseNo })))
    })
  }

  // A number in a path becomes its text, so priorityId 42 would find the priority "42" if there is one. With
  // one in place, the `is string` test in the rules is the only thing that can refuse the award.
  test('an award with a priorityId that is a number is refused even when a priority has that id', async () => {
    await asAdmin((db) => setDoc(guildDoc(db, 'lootPriorities/42'), priorityDoc()))
    await expectDenied(raidLeaderAward(awardDoc({ priorityId: 42 })))
  })

  for (const field of ['priorityId', 'recipient', 'prioritySnapshot', 'councilNoteSnapshot']) {
    test(`an award with no ${field} is refused`, async () => {
      await expectDenied(raidLeaderAward(without(awardDoc(), field)))
    })
  }

  const reordered = [PLAYER_3, PLAYER_2, PLAYER_1]

  test('an award built before the priority changed is refused afterwards', async () => {
    const stale = awardDoc() // what the dialog captured when it opened
    await expectAllowed(updateDoc(guildDoc(dbFor('guildLeader'), `lootPriorities/${PRIORITY_ID}`), { rankedPlayers: reordered }), 'someone reorders the priority')
    await expectDenied(raidLeaderAward(stale), 'the stale award')
    await expectAllowed(raidLeaderAward(awardDoc({ prioritySnapshot: reordered })), 'an award built from the new order')
  })

  // The snapshot is compared with the priority as it was before the batch, so an award batched together
  // with an edit to its own priority has to describe the order from before the edit.
  const editPriorityAndAward = (snapshot: string[]) => {
    const db = dbFor('raidLeader')
    const batch = writeBatch(db)
    batch.update(guildDoc(db, `lootPriorities/${PRIORITY_ID}`), { rankedPlayers: reordered })
    batch.set(doc(guildCollection(db, 'awards')), awardDoc({ prioritySnapshot: snapshot }))
    return batch.commit()
  }

  test('in a batch with a priority edit, an award describing the order before the edit is accepted', async () => {
    await expectAllowed(editPriorityAndAward([PLAYER_1, PLAYER_2, PLAYER_3]))
  })

  test('in a batch with a priority edit, an award describing the order after the edit is refused', async () => {
    await expectDenied(editPriorityAndAward(reordered))
  })

  // KNOWN GAP: the snapshot is compared with the stored priority, which any Raid Leader can edit first.
  // So the check proves the award is consistent with the priority right now, not that the council ever
  // ranked the recipient: a Raid Leader can add anyone to the list and then award them.
  test('KNOWN GAP: a Raid Leader can edit the priority to add a recipient and then award them', async () => {
    const db = dbFor('raidLeader')
    const rigged = ['player-9', PLAYER_1, PLAYER_2, PLAYER_3]
    await expectAllowed(updateDoc(guildDoc(db, `lootPriorities/${PRIORITY_ID}`), { rankedPlayers: rigged }), 'editing the priority')
    await expectAllowed(raidLeaderAward(awardDoc({ recipient: 'player-9', prioritySnapshot: rigged })), 'awarding the added player')
  })

  // KNOWN GAP: no key whitelist and no checks on the other fields.
  test('KNOWN GAP: extra fields and an unchecked awardedAt are accepted', async () => {
    await expectAllowed(raidLeaderAward(awardDoc({ extra: 'anything', awardedAt: 'not a date', awardNote: 'x'.repeat(50_000) })))
  })
})

// match /awards/{awardId}: a Guild Leader creates an award
// The create rule is `isGuildLeader(guildId) || (canManageRaid(guildId) && hasPrioritySnapshot(guildId))`, so
// a Guild Leader never reaches the snapshot check. The branch looks like it exists for the one-time import of
// local preview data (importLocalPreviewData in src/guildApi.ts), which writes awards in bulk without a stored priority.
describe("a Guild Leader's award", () => {
  test('an award that matches the priority is accepted', async () => {
    await expectAllowed(guildLeaderAward(awardDoc()))
  })

  // KNOWN GAP: for a Guild Leader nothing about the award is checked, so the snapshot guarantee does not
  // hold for awards a Guild Leader writes, only for awards a Raid Leader writes.
  const unchecked: [string, Record<string, unknown>][] = [
    ['a snapshot that does not match the priority', awardDoc({ prioritySnapshot: ['player-9'], councilNoteSnapshot: 'Invented note' })],
    ['a recipient who is not on any list', awardDoc({ recipient: 'player-9' })],
    ['a priorityId that names no priority', awardDoc({ priorityId: 'priority-404' })],
    ['fields of the wrong type', awardDoc({ recipient: 42, prioritySnapshot: 'abc' })],
    ['no fields at all', {}],
  ]
  for (const [what, payload] of unchecked) {
    test(`KNOWN GAP: an award with ${what} is accepted`, async () => {
      await expectAllowed(guildLeaderAward(payload))
    })
  }
})

// match /awards/{awardId}: update and delete
// Always false. The tests above change the data an award is compared with; none of them can change the award.
describe('awards cannot be changed once written', () => {
  for (const who of ['raidLeader', 'guildLeader'] as const) {
    test(`the ${LABEL[who]} who recorded an award cannot amend or delete it`, async () => {
      const db = dbFor(who)
      const ref = await addDoc(guildCollection(db, 'awards'), awardDoc())
      const before = await stored(`awards/${ref.id}`)

      await expectDenied(updateDoc(ref, { prioritySnapshot: [PLAYER_3, PLAYER_2, PLAYER_1] }), 'rewriting the snapshot')
      await expectDenied(updateDoc(ref, { recipient: PLAYER_3 }), 'changing the recipient')
      await expectDenied(setDoc(ref, awardDoc({ recipient: PLAYER_3 })), 'replacing the award')
      await expectDenied(deleteDoc(ref), 'deleting the award')
      assert.deepEqual(await stored(`awards/${ref.id}`), before)
    })
  }

  test('an award keeps its snapshot after the priority it came from is changed or deleted', async () => {
    const db = dbFor('raidLeader')
    const ref = await addDoc(guildCollection(db, 'awards'), awardDoc())
    await expectAllowed(setDoc(guildDoc(db, `lootPriorities/${PRIORITY_ID}`), priorityDoc({ rankedPlayers: [PLAYER_3], councilNote: 'Rewritten' })))
    await expectAllowed(deleteDoc(guildDoc(db, `lootPriorities/${PRIORITY_ID}`)))
    assert.deepEqual((await stored(`awards/${ref.id}`))?.prioritySnapshot, [PLAYER_1, PLAYER_2, PLAYER_3])
    assert.equal((await stored(`awards/${ref.id}`))?.councilNoteSnapshot, 'Test council note')
  })
})
